const serverless = require('serverless-http');
const app = require('../server');
const db = require('../db');

// Ensure database connection is reused
// (This is a simplified approach; handling connections in Lambda can be more complex)

module.exports.handler = serverless(app);
