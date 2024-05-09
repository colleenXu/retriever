import path from "path";
import apiList from "../../config/api_list";
import TRAPIQueryHandler from "@retriever/query_graph_handler";
import swaggerValidation from "../../middlewares/validate";
import { asyncquery, asyncqueryResponse } from "../../controllers/async/asyncquery";
import * as utils from "../../utils/common";
import { taskResponse } from "../../controllers/threading/threadHandler";
import { BteRoute } from "../../types";
const smartAPIPath = path.resolve(
  __dirname,
  process.env.STATIC_PATH ? `${process.env.STATIC_PATH}/data/smartapi_specs.json` : "../../../data/smartapi_specs.json",
);
const predicatesPath = path.resolve(
  __dirname,
  process.env.STATIC_PATH ? `${process.env.STATIC_PATH}/data/predicates.json` : "../../../data/predicates.json",
);

import { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { QueueData, TaskInfo } from "@retriever/types";

class V1AsyncQueryByTeam implements BteRoute {
  setRoutes(app: Express) {
    app
      .route("/v1/team/:team_name/asyncquery")
      .post(swaggerValidation.validate, (async (req: Request, res: Response, next: NextFunction) => {
        const queueData: QueueData = {
          route: req.route.path,
          queryGraph: req.body?.message.query_graph,
          teamName: req.params.team_name,
          workflow: req.body?.workflow,
          callback_url: req.body?.callback,
          options: {
            logLevel: req.body?.log_level,
            submitter: req.body?.submitter,
            ...req.query,
          },
        };
        if (req.body?.bypass_cache) {
          queueData.options.caching = false;
        }
        await asyncquery(req, res, next, queueData, global.queryQueue["bte_query_queue_by_team"]);
      }) as RequestHandler)
      .all(utils.methodNotAllowed);
  }

  async task(taskInfo: TaskInfo) {
    const jobID = taskInfo.id,
      queryGraph = taskInfo.data.queryGraph,
      workflow = taskInfo.data.workflow,
      callback_url = taskInfo.data.callback_url,
      options = { ...taskInfo.data.options, schema: await utils.getSchema() },
      teamName = taskInfo.data.teamName,
      enableIDResolution = taskInfo.data.enableIDResolution,
      jobURL = taskInfo.data.url ?? null;

    global.queryInformation = {
      jobID,
      queryGraph,
      callback_url,
    };

    utils.validateWorkflow(workflow);
    const handler = new TRAPIQueryHandler(
      { apiList, teamName, enableIDResolution, ...options },
      smartAPIPath,
      predicatesPath,
      false,
    );
    handler.setQueryGraph(queryGraph);
    const result = await asyncqueryResponse(handler, callback_url, jobID, jobURL, queryGraph);
    taskResponse(result);
  }
}

export default new V1AsyncQueryByTeam();
