const kg = require("@biothings-explorer/smartapi-kg");
const id_resolver = require("@biothings-explorer/id_resolver");
const call_api = require("@biothings-explorer/call-apis");
const camelCase = require('camelcase');
const camelcase = require("camelcase");
const ID_WITH_PREFIXES = ["MONDO", "DOID", "UBERON",
    "EFO", "HP", "CHEBI", "CL", "MGI"];

const meta_kg = new kg();
meta_kg.constructMetaKGSync();

/**
 * Translator Reasoner Std API query graph into BTE input
 */
module.exports = class ReasonerQueryGraphTranslator {
    constructor(queryGraph) {
        this.queryGraph = queryGraph;
        this.snake2Pascal();
        this.kg = meta_kg;
        this.restructureNodes();
        this.extractAllInputs();
        this.findUniqueEdges();
    }

    /**
     * Convert snakecase to PascalCase for all nodes in query graph
     */
    snake2Pascal() {
        this.queryGraph.nodes = this.queryGraph.nodes.map(node => {
            if ("type" in node) {
                node.type = camelcase(node.type, { pascalCase: true })
            }
            return node;
        })
    }

    findQueryGraphNodeID(curie = null, type = null) {
        if (!(curie === null)) {
            let node = this.queryGraph.nodes.filter(node => node.curie === curie);
            return node[0].id;
        }
        if (!(type === null)) {
            let node = this.queryGraph.nodes.filter(node => node.type === type);
            return node[0].id;
        }
    }

    findQueryGraphEdgeID(source_id, target_id, label = null) {
        let tmp = this.queryGraph.edges.filter(edge => edge.source_id === source_id && edge.target_id === target_id);
        let res = tmp;
        if (!(label === null)) {
            res = tmp.filter(edge => edge.relation === label)
        } else {
            res = tmp.filter(edge => !('relation' in edge));
        }
        return res[0].id;
    }

    /**
     * Restructure the nodes from query graph
     */
    restructureNodes() {
        this.nodes = {};
        this.queryGraph.nodes.map(node => {
            this.nodes[node.id] = node;
        })
    }

    /**
     * Extract all curies from the query graph.
     */
    extractAllInputs() {
        this.inputs = [];
        this.queryGraph.nodes.map(node => {
            if ("curie" in node) {
                this.inputs.push(node.curie);
            }
        })
    }

    /**
     * Get all unique edges represented by subject-predicate-object
     */
    findUniqueEdges() {
        this.edges = {};
        this.queryGraph.edges.map(edge => {
            if ("curie" in this.nodes[edge.source_id]) {
                let relation = edge.relation;
                if (!("relation" in edge)) {
                    relation = "None"
                }
                let edge_name = this.nodes[edge.source_id].type + '-' + relation + '-' + this.nodes[edge.target_id].type;
                if (!(edge_name in this.edges)) {
                    this.edges[edge_name] = {
                        reasoner_edges: [],
                        curies: []
                    }
                }
                this.edges[edge_name].reasoner_edges.push(edge);
                this.edges[edge_name].curies.push(this.nodes[edge.source_id].curie)
            }
        })
    }

    /**
     * Find SmartAPI Meta-KG edges corresponding to individual Reasoner query graph edge
     * @param {string} edge - edge representing subject-predicate-object 
     */
    findMetaKGEdges(edge) {
        let [sub, pred, obj] = edge.split('-');
        let filterCriteria = {
            input_type: sub,
            output_type: obj
        }
        if (!(pred === "None")) {
            filterCriteria['predicate'] = pred;
        } else {
            pred = null;
        }
        let smartapi_edges = this.kg.filter(filterCriteria);
        smartapi_edges = smartapi_edges.map(item => {
            item.reasoner_edge = edge;
            return item;
        });
        return smartapi_edges;
    }

    /**
     * Resolve input ids
     * @param {array} curies - list of 
     */
    async annotateIDs() {
        this.resolved_ids = await id_resolver(this.inputs);
    }

    /**
     * Annotate an edge with resolved identifiers
     * @param {object} edge 
     */
    annotateEdgeWithResolvedIds(edge) {
        edge['equivalent_identifiers'] = {};
        edge.curies.map(curie => {
            edge['equivalent_identifiers'][curie] = this.resolved_ids[curie];
        })
        return edge;
    }

    /**
     * Annotate reasoner query graph edges with resolved ids and corresponding Meta-KG edges used in BTE
     */
    annotateEdges() {
        Object.keys(this.edges).map(edge => {
            let smartapi_edges = this.findMetaKGEdges(edge);
            this.annotateEdgeWithResolvedIds(this.edges[edge]);
            this.edges[edge]["smartapi_edges"] = [];
            smartapi_edges.map(item => {
                let newEdges = this.addInputsToEdges(this.edges[edge].equivalent_identifiers, item);
                this.edges[edge]["smartapi_edges"] = [...this.edges[edge]["smartapi_edges"], ...newEdges];
            })
        })
    }

    /**
     * Add inputs to smartapi edges
     */
    addInputsToEdges(resolvedIDs, edge) {
        const inputID = edge.association.input_id;
        const supportBatch = edge.query_operation.supportBatch;
        let res = [];
        if (supportBatch === false) {
            Object.keys(resolvedIDs).map(curie => {
                if (inputID in resolvedIDs[curie]["bte_equivalent_identifiers"]) {
                    resolvedIDs[curie]["bte_equivalent_identifiers"][inputID].map(id => {
                        edge["input"] = id;
                        edge["input_resolved_identifiers"] = { [curie]: resolvedIDs[curie] };
                        if (!(ID_WITH_PREFIXES.includes(inputID))) {
                            edge["original_input"] = { [inputID + ':' + id]: curie }
                        } else {
                            edge["original_input"] = { [id]: curie };
                        }
                        res.push(edge);
                    })
                }
            })
        } else {
            let id_mapping = {};
            let input = [];
            Object.keys(resolvedIDs).map(curie => {
                if (inputID in resolvedIDs[curie]["bte_equivalent_identifiers"]) {
                    resolvedIDs[curie]["bte_equivalent_identifiers"][inputID].map(id => {
                        if (!(ID_WITH_PREFIXES.includes(inputID))) {
                            id_mapping[inputID + ':' + id] = curie;
                        } else {
                            id_mapping[id] = curie;
                        }
                        input.push(id);
                    })
                }
            })
            if (Object.keys(id_mapping).length > 0) {
                edge["input"] = input;
                edge["input_resolved_identifiers"] = resolvedIDs;
                edge["original_input"] = id_mapping;
                res.push(edge);
            }
        };
        return res;
    }

    /**
     * Translate ReasonerStdAPI query graph into BTE edges
     */
    async queryPlan() {
        await this.annotateIDs();
        this.annotateEdges();
    }

    /**
     * Excute queries using BTE call api module
     */
    async queryExecute() {
        this.smartapi_edges = [];
        Object.keys(this.edges).map(edge => {
            this.smartapi_edges = [...this.smartapi_edges, ...this.edges[edge].smartapi_edges];
        });
        let executor = new call_api(this.smartapi_edges);
        await executor.query();
        this.query_result = executor.result;
    }

    /**
     * Translate query result to ReasonerStdAPI format
     */
    responseTranslate() {
        let added_nodes = [];
        this.reasonStdAPIResponse = {
            query_graph: this.queryGraph,
            knowledge_graph: {
                edges: [],
                nodes: []
            },
            results: []
        };
        this.query_result.map(item => {
            let input = item.$original_input[item.$input];
            let input_query_graph_id = this.findQueryGraphNodeID(input, null);
            let output_query_graph_id = this.findQueryGraphNodeID(null, item.$association.output_type);
            let pred = item.$reasoner_edge.split('-')[1];
            if (pred === "None") {
                pred = null
            }
            let edge_query_graph_id = this.findQueryGraphEdgeID(input_query_graph_id, output_query_graph_id, pred);
            this.reasonStdAPIResponse.knowledge_graph.edges.push({
                type: item.$association.predicate,
                relation: item.$association.predicate,
                target_id: item.$output,
                source_id: input,
                id: [input, item.$association.predicate, item.$output].join('--'),
                provided_by: item.$association.source,
                publications: item.pubmed
            });
            this.reasonStdAPIResponse.results.push({
                edge_bindings: [
                    {
                        qg_id: edge_query_graph_id,
                        kg_id: [input, item.$association.predicate, item.$output].join('--')
                    }
                ],
                node_bindings: [
                    {
                        kg_id: input,
                        qg_id: input_query_graph_id
                    },
                    {
                        kg_id: item.$output,
                        qg_id: output_query_graph_id
                    }
                ]
            })
            if (!(added_nodes.includes(item.$output))) {
                this.reasonStdAPIResponse.knowledge_graph.nodes.push({
                    id: item.$output,
                    name: item.$output_id_mapping.resolved.id.label,
                    type: item.$association.output_type,
                    equivalent_identifiers: item.$output_id_mapping.resolved.equivalent_identifiers
                })
                added_nodes.push(item.$output);
            }
            if (!(added_nodes.includes(input))) {
                this.reasonStdAPIResponse.knowledge_graph.nodes.push({
                    id: input,
                    name: item.$input_resolved_identifiers[input].id.label,
                    type: item.$association.input_type
                })
                added_nodes.push(input);
            }
        })

    }
}