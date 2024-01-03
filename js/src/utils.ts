import chalk from "chalk";
import { JsonRpcError, JsonRpcParamsSchema, JsonRpcPayload, JsonRpcPayloadNotification, JsonRpcPayloadRequest, MethodNotFound, format, parse } from "json-rpc-protocol";
import { RawData, WebSocket, WebSocketServer } from 'ws';

let rpcId = 0;
export async function jsonRpcInvoke(ws: WebSocket, method: string, params?: JsonRpcParamsSchema) {
  const id = rpcId++;
  let listener: any = null;
  const res = new Promise(function (resolve, reject) {
    listener = function (data: RawData, isBinary: boolean) {
      try {
        const rpc = parse(data.toString()) as JsonRpcPayload;
        if (rpc.type === 'response' && rpc.id === id) {
          resolve(rpc.result);
        } else if (rpc.type === 'error' && rpc.id === id) {
          throw new JsonRpcError(rpc.error.message, rpc.error.code, rpc.error.data);
        } else {
          throw new Error(`unexpected response ${rpc}`);
        }
      } catch (e) {
        reject(e);
      }
    };
    ws.addListener('message', listener);
  });
  ws.send(format.request(id, method, params));
  return Promise.race([timeoutReject(), res]).finally(() => {
    ws.removeListener('message', listener);
  });
}

export function jsonRpcNotice(ws: WebSocket, method: string, params?: JsonRpcParamsSchema) {
  ws.send(format.notification(method, params));
}

export async function timeoutResolve() {
  return new Promise<void>(function (resolve, reject) {
    setTimeout(function () {
      resolve();
    }, 10000);
  });
}

export async function timeoutReject() {
  return new Promise<void>(function (resolve, reject) {
    setTimeout(function () {
      reject(new Error("timeout"));
    }, 10000);
  });
}

export function useClientLogger(ws: WebSocket, info: { remoteUrl: string; localUrl: string; }) {
  ws.on('message', function message(data) {
    console.log(chalk.bgYellow(info.remoteUrl, '->', info.localUrl), data.toString(), ws.protocol);
  });
  ws.on('open', function open() {
    info.remoteUrl = ws.url;
    console.log(chalk.bgYellow(`open`), info.remoteUrl);
  });
  ws.on('error', function error(err: Error) {
    console.error(chalk.bgRed(`error`), err);
  });
  ws.on('close', function close() {
    console.log(chalk.bgYellow(`close`), info.remoteUrl);
  });
  const realSend = ws.send;
  ws.send = function (...args: any[]) {
    console.log(chalk.bgGreen(info.remoteUrl, '<-', info.localUrl), args[0]);
    realSend.apply(this, args as any);
  };
}

export function useServerLogger(wss: WebSocketServer) {
  wss.on('connection', function connection(ws, request) {
    const remoteUrl = [request.socket.remoteAddress, request.socket.remotePort].join(":").replace(/^::ffff:/, '');
    console.log(chalk.bgYellow('open'), remoteUrl);
    useClientLogger(ws, {
      localUrl: '',
      remoteUrl: remoteUrl
    });
  });
}

export type JsonRpcOptions = {
  methods: { [key: string]: (this: WebSocket, rpc: JsonRpcPayloadRequest) => any; };
  subscriptions: { [key: string]: (this: WebSocket, rpc: JsonRpcPayloadNotification) => any; };
};

export function useJsonRpcForWss(wss: WebSocketServer, options: JsonRpcOptions) {
  wss.on('connection', function connection(ws) {
    useJsonRpcForWs(ws, options);
  });
}

export function useJsonRpcForWs(ws: WebSocket, options: JsonRpcOptions) {
  ws.on('message', function message(data: RawData, isBinary: boolean) {
    const dataStr = data.toString();
    try {
      const rpcRaw = parse(dataStr);
      let rpcList = [];
      if (Array.isArray(rpcRaw)) {
        rpcList = rpcRaw as Array<JsonRpcPayload>;
      } else {
        rpcList = [rpcRaw as JsonRpcPayload];
      }
      rpcList.forEach(rpc => {
        if (rpc.type === 'request') {
          const method = options.methods[rpc.method];
          if (method) {
            const res = method.apply(ws, [rpc]);
            if (res instanceof Promise) {
              res.then(res => {
                ws.send(format.response(rpc.id, res));
              }).catch(e => {
                if (e instanceof Error) {
                  ws.send(format.error(rpc.id, new JsonRpcError(e.message)));
                } else {
                  ws.send(format.error(rpc.id, e));
                }
              });
            } else {
              ws.send(format.response(rpc.id, res));
            }
          } else {
            ws.send(format.error(rpc.id, new JsonRpcError(`method: ${rpc.method} not found`)));
          }
        } else if (rpc.type === 'notification') {
          const subscription = options.subscriptions[rpc.method];
          if (subscription) {
            subscription.apply(ws, [rpc]);
          }
        }
      });
    } catch (e) {
      console.error('invalid rpc', e);
    }
  });
}