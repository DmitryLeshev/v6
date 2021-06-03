"use strict";

const fs = require("fs").promises;
const path = require("path");
const vm = require("./vm.js");

const { Schema } = require("./schema.js");

const readScript = async (filePath, options) => {
  const src = await fs.readFile(filePath, "utf8");
  if (!src) return null;
  const name =
    options && options.filename
      ? options.filename
      : path.basename(filePath, ".js");
  const script = new vm.Script(name, src, options);
  return script;
};

const createSchema = (name, src) => {
  const { exports } = new vm.Script(name, src);
  const entity = new Schema(name, exports);
  return entity;
};

const loadSchema = async (fileName) => {
  const src = await fsp.readFile(fileName, "utf8");
  const name = path.basename(fileName, ".js");
  const { exports } = new vm.Script(name, src);
  const entity = new Schema(name, exports);
  return entity;
};

const readDirectory = async (dirPath) => {
  const files = await fsp.readdir(dirPath, { withFileTypes: true });
  const structs = new Map();
  for (const file of files) {
    if (file.isDirectory()) continue;
    if (!file.name.endsWith(".js")) continue;
    const absPath = path.join(dirPath, file.name);
    const { name, exports } = await vm.readScript(absPath);
    structs.set(name, exports);
  }
  return structs;
};

module.exports = { readScript, readDirectory, createSchema, loadSchema };
