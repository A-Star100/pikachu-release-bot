// api/github/webhooks.js
const { createProbot } = require("probot");
const appFn = require("../../../app");

const probot = createProbot();

module.exports = async (req, res) => {
  try {
    const handler = await probot.load(appFn);
    await handler(req, res);
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
};
