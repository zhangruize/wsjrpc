import chalk from 'chalk';
import { JsonRpcParamsSchemaByName, JsonRpcPayloadNotification, JsonRpcPayloadRequest } from 'json-rpc-protocol';
import { WebSocket, WebSocketServer } from 'ws';
import { jsonRpcInvoke, jsonRpcNotice, useJsonRpcForWss, useServerLogger } from './utils';

type ClientInfo = {
  name: string;
  desc: string;
  subscription: string[];
};

const ip = require('ip');
const wss = new WebSocketServer({ port: 8080 });
const clientsMap = new Map<WebSocket, ClientInfo>();
const subscriptions: { [key: string]: (this: WebSocket, rpc: JsonRpcPayloadNotification) => any; } = {
};
const methods: { [key: string]: (this: WebSocket, rpc: JsonRpcPayloadRequest) => any; } = {
  introduce(this: WebSocket, rpc: JsonRpcPayloadRequest) {
    const { name, desc } = rpc.params as JsonRpcParamsSchemaByName;
    if (!name) {
      throw new Error("name is required");
    }
    clientsMap.set(this, { name, desc, subscription: [] });
    return true;
  },
  list(this: WebSocket) {
    const res = Array.from(wss.clients.values()).map(info => {
      const clientInfo = clientsMap.get(info);
      return Object.assign({}, clientInfo, { methods: Object.keys(methods).filter(it => it.startsWith((clientInfo?.name ?? "") + ".")) });
    });
    const svr = {
      name: 'server',
      desc: 'server',
      subscription: Object.keys(subscriptions),
      methods: Object.keys(methods).filter(it => !it.includes("."))
    };
    res.unshift(svr);
    return res;
  },
  registerMethod(this: WebSocket, rpc: JsonRpcPayloadRequest) {
    const { name, desc } = rpc.params as JsonRpcParamsSchemaByName;
    const clientInfo = clientsMap.get(this);
    if (!clientInfo) {
      throw new Error("can't find related client info, introduce your self first");
    }
    const fullMethodName = [clientInfo.name, name].join('.');
    const that = this;
    methods[fullMethodName] = async function (this: WebSocket, rpc: JsonRpcPayloadRequest) {
      try {
        const res = await jsonRpcInvoke(that, name, rpc.params);
        return res;
      } catch (e) {
        throw e;
      }
    };
    return true;
  },
  subscribe(this: WebSocket, rpc: JsonRpcPayloadRequest) {
    const { name } = rpc.params as JsonRpcParamsSchemaByName;
    const clientInfo = clientsMap.get(this);
    if (!clientInfo) {
      throw new Error("can't find related client info, introduce your self first");
    }
    if (!clientInfo.subscription.includes(name)) {
      clientInfo.subscription.push(name);
    }
    const fullMethodName = [clientInfo.name, name].join('.');
    const that = this;
    subscriptions[fullMethodName] = function (this: WebSocket, rpc: JsonRpcPayloadNotification) {
      try {
        jsonRpcNotice(that, name, rpc.params);
      } catch (e) {
        throw e;
      }
    };
    return true;
  },
  broadcast(this: WebSocket, rpc: JsonRpcPayloadRequest) {
    const { name, params } = rpc.params as JsonRpcParamsSchemaByName;
    Array.from(wss.clients).forEach(it => {
      if (it !== this) {
        const clientInfo = clientsMap.get(it);
        if (!clientInfo) {
          throw new Error("can't find related client info, introduce your self first");
        }
        if (clientInfo.subscription.includes(name)) {
          jsonRpcNotice(it, name, params);
        }
      }
    });
    return true;
  },
};

useServerLogger(wss);
useJsonRpcForWss(wss, { methods, subscriptions });
console.log(chalk.bgGreen('WebSocket Server is running on '), 'http://' + ip.address() + ':' + wss.options.port);
