const config = require("../config.js");
const database = require("../database.js");
const logger = require("../logger.js");
const utils = require("../utils");
const server = require("../server.js");

const common = { config, database, logger, server, utils };

module.exports = common;
