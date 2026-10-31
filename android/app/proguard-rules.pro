# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Capacitor's bridge discovers and calls plugin methods via reflection
# (@CapacitorPlugin / @PluginMethod), which R8 would otherwise rename or
# strip as apparently-unused. This app's own ServerConfigPlugin (the
# bootstrap URL/mTLS-cert bridge every WebView load depends on) needs the
# same protection Capacitor's own plugins get.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public *;
}
-keep class org.apache.cordova.** { *; }

# Capacitor plugins that live outside com.getcapacitor.** (Preferences,
# Filesystem, LocalNotifications, Network, App, RevenueCat). They are loaded by
# class name from capacitor.plugins.json and their model/receiver classes are
# reached via reflection, manifest entries (LocalNotifications' boot/alarm
# receivers) and JSON (de)serialisation, so keep them whole rather than rely on
# the annotation rules above alone. The SQLite plugin is under
# com.getcapacitor.community.** and is already covered.
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.revenuecat.purchases.capacitor.** { *; }

# Tink (pulled in by androidx.security:security-crypto, which the encrypted
# SQLite plugin uses for its key store) reads protobuf-lite message fields by
# reflection. Newer tink-android ships this as a consumer rule; keep it here
# so an older transitive version can't lose it.
-keepclassmembers class * extends com.google.crypto.tink.shaded.protobuf.GeneratedMessageLite {
    <fields>;
}

# Tink references compile-time-only annotations (Error Prone, JSR-305) that
# are not on the runtime classpath, so R8 reports them as missing classes and
# fails the build. They carry no runtime behaviour; ignoring them is the
# documented fix. Exactly the classes R8 reported (v0.19.1 run), as packages:
#   com.google.errorprone.annotations.{CanIgnoreReturnValue,CheckReturnValue,
#     Immutable,RestrictedApi}
#   javax.annotation.Nullable, javax.annotation.concurrent.GuardedBy
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**

# sqlcipher-android (the encrypted SQLite engine behind the sqlite plugin) is
# JNI-backed: native code looks up these Java classes/methods/fields by name,
# so they must not be renamed or stripped. Also keep every native-method
# holder, since R8 would otherwise rename them and break JNI linking
# (UnsatisfiedLinkError).
-keep class net.zetetic.database.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
