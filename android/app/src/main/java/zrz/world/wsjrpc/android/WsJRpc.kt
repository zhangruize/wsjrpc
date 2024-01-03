package zrz.world.wsjrpc.android

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.Method
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

typealias Subscriber = (eventName: String, params: JSONObject?) -> Unit
typealias InvokeCallback<T> = (result: Result<T?>) -> Unit

private const val TAG = "WsJRPC"

object WsJRpc {
    private val client = OkHttpClient()
    private var curWs: WebSocket? = null
    private const val ERROR_CODE_METHOD_NOT_FOUND = -32601
    private const val ERROR_CODE_INTERNAL_ERROR = -32603
    private val invokeId = AtomicInteger(0)
    private val callbackMap = ConcurrentHashMap<Int, InvokeCallback<Any?>>()
    private val methodMap = ConcurrentHashMap<String, MethodInvoke>()
    private val subscriberMap = ConcurrentHashMap<String, CopyOnWriteArrayList<Subscriber>>()

    fun connect(url: String) {
        val request = Request.Builder()
            .url(url)
            .build()
        val wsListener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Connected!")
                curWs = webSocket
                invokeDevTools<Any>("introduce", JSONObject().apply {
                    put("name", "android")
                }, { res ->
                })
                methodMap.forEach {
                    invokeDevTools<Any>("registerMethod", JSONObject().apply {
                        put("name", it.key)
                    }, { res ->
                    })
                }
            }

            // 当接收到字符串消息时调用
            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMsg(text)
            }

            // 当Socket连接处于 Closing or Closed 状态时调用
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Closing: $code, $reason")
            }

            // 如果在WebSocket准备发送消息或接收消息时出现错误，则会调用这个方法
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Error : " + t.message, Throwable())
            }
        }
        client.newWebSocket(request, wsListener)

    }

    fun handleMsg(text: String) {
        val params = JSONObject(text)
        Log.d(TAG, "[DevTools ---> Client] $params")
        val hasInt = params.has("id")
        val id = if (hasInt) params.optInt("id") else null
        val result = params.opt("result")
        val methodName = params.optString("method")
        val methodParams = params.optJSONObject("params")
        val error = params.optJSONObject("error")
        if (result != null || error != null) {
            // invoke devTools result callback
            val callback = callbackMap[id]
            if (callback != null) {
                if (result != null) {
                    callback.invoke(Result.success(result))
                } else if (error != null) {
                    callback.invoke(Result.failure(Throwable(error.toString())))
                }
            } else {
                Log.i(TAG, "can't find callback for id: $id")
            }
            callbackMap.remove(id)
        } else if (!methodName.isNullOrEmpty()) {
            // invoke client method
            if (id != null) {
                invokeClient(id, methodName, methodParams)
            } else {
                // notice client
                val subscribers = subscriberMap[methodName]
                if (subscribers != null) {
                    subscribers.forEach { sub ->
                        sub.invoke(methodName, methodParams)
                    }
                } else {
                    Log.i(TAG, "can't find subscriber for event: $methodName")
                }
            }
        }
    }

    /**
     * DevTools -> client
     */
    private fun invokeClient(id: Int, methodName: String, params: JSONObject?) {
        var invokeResult: Any? = null
        var invoked = false
        var invokeErrorCode = ERROR_CODE_METHOD_NOT_FOUND
        var invokeErrorMessage = "Method not found: $methodName"
        methodMap[methodName]?.run {
            try {
                invokeResult = method.invoke(instance, params)
                invoked = true
            } catch (exception: Throwable) {
                invokeErrorCode = ERROR_CODE_INTERNAL_ERROR
                invokeErrorMessage = exception.message ?: "Internal error"
            }
        }
        // send result
        sendToDevTools(JSONObject().apply JSONObject@{
            put("id", id)
            if (invoked) {
                put("result", if (invokeResult == null) JSONObject.NULL else invokeResult)
            } else {
                put("error", JSONObject().apply {
                    put("code", invokeErrorCode)
                    put("message", invokeErrorMessage)
                })
            }
        })
    }

    /**
     * client -> DevTools
     */
    fun <T> invokeDevTools(methodName: String, params: JSONObject, callback: InvokeCallback<T>) {
        val id = invokeId.incrementAndGet()
        callbackMap[id] = callback as InvokeCallback<Any?>
        sendToDevTools(JSONObject().apply JSONObject@{
            put("method", methodName)
            put("params", params)
            put("id", id)
        })
    }

    fun noticeDevTools(eventName: String, vararg params: Any) {
        sendToDevTools(JSONObject().apply JSONObject@{
            put("method", eventName)
            put("params", JSONArray().apply JSONArray@{
                params.forEach {
                    this@JSONArray.put(it)
                }
            })
        })
    }

    fun registerModule(module: Any) {
        module.javaClass.methods.forEach { method ->
            val annotation = method.getAnnotation(JRpcMethod::class.java)
            if (annotation != null) {
                val oldMethod = methodMap[method.name]
                if (oldMethod != null) {
                    Log.e(TAG, "can't register existing method ${method.name}")
                } else {
                    Log.i(TAG, "register method ${method.name}")
                    methodMap[method.name] = MethodInvoke(method, module)
                }
            }
        }
    }

    fun subscribeDevToolsNotification(eventName: String, subscriber: Subscriber) {
        if (!subscriberMap.containsKey(eventName)) {
            subscriberMap[eventName] = CopyOnWriteArrayList()
        }
        subscriberMap[eventName]?.add(subscriber)
    }

    fun unsubscribeDevToolsNotification(eventName: String, subscriber: Subscriber) {
        subscriberMap[eventName]?.remove(subscriber)
    }

    private fun sendToDevTools(rpcObject: JSONObject) {
        rpcObject.apply {
            put("jsonrpc", "2.0")
        }
        curWs?.send(rpcObject.toString().also {
            Log.d(TAG, "[Client ---> DevTools] $it")
        })
    }

    class MethodInvoke(val method: Method, val instance: Any)
}

@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class JRpcMethod