package in.gov.sih.kaarigar;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Let a DEBUG build talk to a plain-HTTP dev API on the LAN.
     *
     * Capacitor serves this app from https://localhost (androidScheme in
     * capacitor.config.json). Chromium will not let an HTTPS page fetch plain-HTTP
     * subresources, so every request to a dev API at http://192.168.x.x:8000 is blocked
     * inside the WebView with "Mixed Content: ... has been blocked", long before Android's
     * network_security_config is consulted. The artisan-facing symptom is "no network" on a
     * phone with full signal — see app/src/api/client.ts.
     *
     * `adb reverse` never hit this: http://localhost is a "potentially trustworthy" origin
     * and is exempt from mixed-content blocking. A LAN address is not, which is why this
     * only appears once the phone comes off the cable.
     *
     * Guarded on FLAG_DEBUGGABLE rather than BuildConfig.DEBUG so it needs no
     * buildFeatures change, and so a release APK provably cannot take this path — mixed
     * content stays blocked in the field, where the API is HTTPS and there is no reason to
     * ever load one.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) {
            getBridge()
                .getWebView()
                .getSettings()
                .setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

            // ⚠️ ALWAYS_ALLOW covers *blockable* mixed content — fetch, XHR, scripts — which
            // is why the API calls work. It does NOT stop Chromium auto-upgrading
            // *optionally-blockable* subresources: an <img> pointed at http://host:8000 is
            // rewritten to https://host:8000, finds no TLS listener, and paints nothing. See
            // app/src/api/useDisplayImage.ts, which fetches image bytes and hands the tag a
            // blob: url instead. Do not "simplify" that back to <img src={url}>.

            // chrome://inspect, or:
            //   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
            // Without this the WebView console is invisible, and the blank <img> above had
            // to be diagnosed by elimination from the server side — far slower than reading
            // one error. Same FLAG_DEBUGGABLE guard, so a release build cannot expose it.
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }
}
