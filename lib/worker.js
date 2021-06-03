const { node } = require("./dependencies");
const { worker, fsp, path, vm } = node;
const { threadId } = worker;

const application = require("./application.js");

const { Config } = require("./config");
const { Logger } = require("./logger");
const { Server } = require("./server");
const { Auth } = require("./auth.js");

(async () => {
  const configPath = path.join(application.path, "config");
  const logPath = path.join(application.root, "log");

  const context = vm.createContext(Object.freeze({ process }));
  const options = { mode: process.env.MODE, context };
  const config = await new Config(configPath, options);

  const logger = await new Logger({
    path: logPath,
    workerId: threadId,
    home: application.root,
    ...config.log,
  });
  const { console } = logger;

  const auth = new Auth({ ...config.sessions });

  Object.assign(application, { config, logger, console, auth });

  const logError = async (err) => {
    console.error(err ? err.stack : "No exception stack available");
    if (application.finalization) return;
    if (application.initialization) {
      console.info(`Can not start Application in worker ${threadId}`);
      await application.shutdown();
      process.exit(0);
    }
  };

  process.on("uncaughtException", logError);
  process.on("warning", logError);
  process.on("unhandledRejection", logError);

  if (config.server.protocol === "https") {
    const certPath = path.join(application.path, "cert");
    try {
      const key = await fsp.readFile(path.join(certPath, "key.pem"));
      const cert = await fsp.readFile(path.join(certPath, "cert.pem"));
      application.cert = { key, cert };
    } catch {
      if (threadId === 1) console.error("Can not load TLS certificates");
      process.exit(0);
    }
  }

  const { balancer, ports = [] } = config.server;
  const servingThreads = ports.length + (balancer ? 1 : 0);
  if (threadId <= servingThreads) {
    application.server = new Server(config.server, application);
  }

  await application.init();
  console.info(`Application started in worker ${threadId}`);
  worker.parentPort.postMessage({ type: "event", name: "started" });

  worker.parentPort.on("message", async (data) => {
    if (data.type === "event" && data.name === "stop") {
      if (application.finalization) return;
      console.info(`Graceful shutdown in worker ${threadId}`);
      await application.shutdown();
      process.exit(0);
    }
  });
})();
