package com.hearthapp.app;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.PersistableBundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android counterpart of SecureClipboardPlugin.swift: copies the standalone
 * backup password (#226) and later clears it only if the clipboard still
 * holds that same clip, so something the user copied in another app since is
 * never wiped.
 *
 * It tells from the clip's description (label and, on API 26+, timestamp),
 * which Android hands over without the "pasted from" notice that reading the
 * clip itself shows. The clip is marked sensitive, so Android 13+ hides it
 * from the clipboard preview.
 */
@CapacitorPlugin(name = "SecureClipboard")
public class SecureClipboardPlugin extends Plugin {

    private static final String LABEL = "Hearth backup password";
    // ClipDescription.EXTRA_IS_SENSITIVE (API 33); older versions ignore it.
    private static final String EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE";

    // Only touched on the UI thread.
    private boolean written = false;
    private long writtenAt = -1;

    private ClipboardManager clipboard() {
        return (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.isEmpty()) {
            call.reject("Missing value");
            return;
        }
        getActivity().runOnUiThread(() -> {
            ClipboardManager clipboard = clipboard();
            ClipData clip = ClipData.newPlainText(LABEL, value);
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(EXTRA_IS_SENSITIVE, true);
            clip.getDescription().setExtras(extras);
            clipboard.setPrimaryClip(clip);
            ClipDescription description = clipboard.getPrimaryClipDescription();
            writtenAt = description != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? description.getTimestamp() : -1;
            written = true;
            call.resolve();
        });
    }

    /** Resolves { cleared, changed }, the same as on iOS. */
    @PluginMethod
    public void clearIfUnchanged(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            if (!written) {
                result.put("cleared", false);
                result.put("changed", true);
                call.resolve(result);
                return;
            }
            // Android 10+ hides the clipboard from an app without focus: try
            // again later rather than guess.
            if (!getActivity().hasWindowFocus()) {
                result.put("cleared", false);
                result.put("changed", false);
                call.resolve(result);
                return;
            }
            ClipboardManager clipboard = clipboard();
            ClipDescription description = clipboard.getPrimaryClipDescription();
            boolean ours = description != null
                    && LABEL.contentEquals(description.getLabel() == null ? "" : description.getLabel())
                    && (writtenAt < 0 || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && description.getTimestamp() == writtenAt));
            written = false;
            if (ours) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    clipboard.clearPrimaryClip();
                } else {
                    clipboard.setPrimaryClip(ClipData.newPlainText("", ""));
                }
            }
            result.put("cleared", ours);
            result.put("changed", !ours);
            call.resolve(result);
        });
    }
}
