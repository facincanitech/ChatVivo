package com.facincanitech.flux;

import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.judemanutd.autostarter.AutoStartPermissionHelper;

@CapacitorPlugin(name = "BatteryOpt")
public class BatteryOptPlugin extends Plugin {

    @PluginMethod
    public void isIgnoringOptimizations(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreOptimizations(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openAutoStartSettings(PluginCall call) {
        boolean opened = false;
        try {
            AutoStartPermissionHelper helper = AutoStartPermissionHelper.Companion.getInstance();
            if (helper.isAutoStartPermissionAvailable(getContext(), false)) {
                opened = helper.getAutoStartPermission(getContext(), true, true);
            }
        } catch (Exception e) {
            opened = false;
        }
        JSObject ret = new JSObject();
        ret.put("opened", opened);
        call.resolve(ret);
    }
}
