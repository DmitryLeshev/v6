"use strict";

const http = require("http");
const https = require("https");
const worker = require("worker_threads");
const ws = require("ws");

const utils = require("./utils");
const { threadId } = worker;

const { semaphore } = utils;
const { Semaphore } = semaphore;
const { Channel, channels } = require("./channel.js");

const SHORT_TIMEOUT = 500;

const receiveBody = async (req) => {
  const buffers = [];
  for await (const chunk of req) {
    buffers.push(chunk);
  }
  return Buffer.concat(buffers).toString();
};

class Server {
  constructor(config, application) {
    this.config = config;
    this.application = application;
    const { host, balancer, protocol, ports, queue } = config;
    const concurrency = queue.concurrency || config.concurrency;
    this.semaphore = new Semaphore(concurrency, queue.size, queue.timeout);
    this.balancer = balancer && threadId === 1;
    const skipBalancer = balancer ? 1 : 0;
    this.port = this.balancer ? balancer : ports[threadId - skipBalancer - 1];
    this.server = null;
    this.ws = null;
    this.protocol = protocol;
    this.host = host;
    this.bind();
  }

  bind() {
    const { config, application, port, host } = this;
    const { protocol, timeouts } = config;
    const transport = protocol === "http" || this.balancer ? http : https;
    const listener = this.listener.bind(this);
    this.server = transport.createServer({ ...application.cert }, listener);

    this.server.on("listening", () => {
      application.console.info(`Listen port ${port} in worker ${threadId}`);
    });

    this.ws = new ws.Server({ server: this.server });
    this.ws.on("connection", async (connection, req) => {
      application.console.log("connection ws");
      // const channel = await new Channel(req, null, connection, application);
      connection.on("message", (data) => {
        // channel.message(data);
        application.console.debug({ data });
        connection.send(data);
      });
      connection.on("close", () => {
        // channels.delete(channel.client);
        // channel.destroy();
      });
    });
    this.ws.on("error", (err) => {
      if (err.code !== "EADDRINUSE") return;
      application.console.warn(`Address in use: ${host}:${port}, retry...`);
      setTimeout(() => {
        this.bind();
      }, timeouts.bind);
    });
    this.server.listen(port, host);
  }

  async listener(req, res) {
    let finished = false;
    const { url } = req;

    const channel = await new Channel(req, res, null, this.application);
    const { client } = channel;

    this.application.console.debug({ client });

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      channels.delete(client);
      channel.error(504);
      channel.destroy();
    }, this.config.timeouts.request);

    res.on("close", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channels.delete(client);
      channel.destroy();
    });

    if (this.balancer) {
      const host = utils.parseHost(req.headers.host);
      const port = utils.sample(this.config.ports);
      const { protocol } = this.config;
      channel.redirect(`${protocol}://${host}:${port}/`);
      return;
    }

    this.application.console.warn({ url });
    if (url.startsWith("/api")) this.request(channel);
    else channel.static();
  }

  request(channel) {
    const { req } = channel;

    if (req.method === "OPTIONS") {
      channel.options();
      return;
    }
    if (req.method !== "POST") {
      channel.error(403);
      return;
    }
    const body = receiveBody(req);
    if (req.url === "/api") {
      body.then((data) => {
        channel.message(data);
      });
    } else {
      body.then((data) => {
        const { pathname, searchParams } = new URL("http://" + req.url);
        const [, interfaceName, methodName] = pathname.split("/");
        const args = data ? JSON.parse(data) : Object.fromEntries(searchParams);
        channel.rpc(-1, interfaceName, methodName, args);
      });
    }
    body.catch((err) => {
      channel.error(500, err);
    });
  }

  closeChannels() {
    //   for (const channel of channels.values()) {
    //     if (channel.connection) {
    //       channel.connection.terminate();
    //     } else {
    //       channel.error(503);
    //       channel.req.connection.destroy();
    //     }
    //   }
  }

  async close() {
    this.server.close((err) => {
      if (err) this.application.console.error(err);
    });
    if (channels.size === 0) {
      await utils.delay(SHORT_TIMEOUT);
      return;
    }
    await utils.delay(this.config.timeouts.stop);
    this.closeChannels();
  }
}

module.exports = { Server };
