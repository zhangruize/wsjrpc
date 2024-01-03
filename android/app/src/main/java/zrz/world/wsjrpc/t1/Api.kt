package zrz.world.wsjrpc.t1

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.telephony.SmsManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import zrz.world.wsjrpc.android.JRpcMethod

class Api(private val context: Context) {

    @JRpcMethod
    fun greet(params: JSONObject): String {
        return "hey there! ${params.optString("name")}"
    }

    @JRpcMethod
    fun vibrate(params: JSONObject) {
        val duration = params.getLong("duration")
        val amplitude =
            if (params.has("amplitude")) params.getInt("amplitude") else VibrationEffect.DEFAULT_AMPLITUDE

        val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator?

        val vibrationEffect = VibrationEffect.createOneShot(duration, amplitude)

        vibrator?.let {
            if (it.hasVibrator()) {
                it.vibrate(vibrationEffect)
            }
        }
    }

    @JRpcMethod
    fun sms(params: JSONObject) {
        if (ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.SEND_SMS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                context as Activity,
                arrayOf(Manifest.permission.SEND_SMS),
                123
            )
        } else {
            val smsManager = SmsManager.getDefault()
            smsManager.sendTextMessage(
                params.getString("number"),
                null,
                params.getString("message"),
                null,
                null
            )
        }
    }
}