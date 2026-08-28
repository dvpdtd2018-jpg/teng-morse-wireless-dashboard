/*
  ESP32 DevKitV1 — universal CS-TENG Morse streamer

  Signal wiring:
    Conditioned CS-TENG signal ---- GPIO 34 (ADC1_CH6)
    Signal reference ------------- GND

  This sketch reads raw calibrated voltage with analogReadMilliVolts(); it
  deliberately does not apply averaging or a low-pass filter. The dashboard
  offers selectable noise-processing channels instead.

  First start / new Wi-Fi network:
    1. The ESP32 creates: TENG-Morse-Setup
    2. Password: morse123
    3. Open http://192.168.4.1 and save the hotspot/router credentials.

  On a saved network it announces a data stream at:
    http://teng-morse.local:81/events

  If the network does not resolve .local names, use the IP printed to Serial.
*/

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ESPmDNS.h>

constexpr uint8_t SENSOR_PIN = 34;            // ADC1_CH6
constexpr uint8_t BOOT_BUTTON_PIN = 0;        // BOOT button on most DevKit V1 boards
constexpr uint16_t STREAM_PORT = 81;
constexpr unsigned long SAMPLE_INTERVAL_MS = 10;
constexpr unsigned long STREAM_INTERVAL_MS = 20;
constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;
constexpr char CONFIG_AP_SSID[] = "TENG-Morse-Setup";
constexpr char CONFIG_AP_PASSWORD[] = "morse123";
constexpr char MDNS_HOSTNAME[] = "teng-morse";

Preferences preferences;
WebServer configServer(80);
WiFiServer streamServer(STREAM_PORT);
WiFiClient streamClient;

bool setupMode = false;
bool restartRequested = false;
bool streamServerStarted = false;
float latestVoltage = 0.0f;
uint32_t latestMillivolts = 0;
unsigned long lastSampleAt = 0;
unsigned long lastStreamAt = 0;
unsigned long restartAt = 0;
unsigned long lastReconnectAttemptAt = 0;

float readVoltage() {
  return analogReadMilliVolts(SENSOR_PIN) / 1000.0f;
}

String page(const String &content) {
  return String(F("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>TENG Morse Wi-Fi Setup</title><style>body{max-width:560px;margin:40px auto;padding:0 20px;color:#101941;background:#f4fbfa;font-family:system-ui,sans-serif}"
    "h1{color:#078c84}label{display:block;margin-top:16px;font-size:13px;font-weight:700}input{box-sizing:border-box;width:100%;margin-top:6px;padding:12px;border:1px solid #b8d3d0;border-radius:8px;font-size:16px}button{margin-top:20px;padding:12px 16px;border:0;border-radius:8px;color:#fff;background:#078c84;font-weight:800}button.danger{background:#b22132}small{color:#5e7280;line-height:1.5}</style><body>")) + content + "</body></html>";
}

void sendSetupPage() {
  const bool connected = WiFi.status() == WL_CONNECTED;
  const String network = connected ? WiFi.SSID() : String(F("setup access point"));
  const String address = connected ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
  String content = String(F("<h1>TENG Morse Wi-Fi Setup</h1><p>Current network: <b>")) + network +
    "</b><br>Setup address: <b>" + address + "</b></p>"
    "<p><small>Save the Wi-Fi network used by both the ESP32 and your computer. After restart, open the computer dashboard and use <b>http://teng-morse.local:81/events</b>. If that name does not work on the hotspot, use the IP printed by Serial Monitor.</small></p>"
    "<form method='post' action='/save'><label>Wi-Fi / hotspot name (SSID)<input required name='ssid' maxlength='32' autocomplete='username'></label>"
    "<label>Wi-Fi password<input name='password' maxlength='63' type='password' autocomplete='current-password'></label><button type='submit'>Save and restart</button></form>"
    "<form method='post' action='/forget'><button class='danger' type='submit'>Forget saved Wi-Fi</button></form>";
  configServer.send(200, "text/html; charset=utf-8", page(content));
}

void requestRestart(const String &message) {
  configServer.send(200, "text/html; charset=utf-8", page("<h1>Saved</h1><p>" + message + "</p><p><small>The ESP32 is restarting now.</small></p>"));
  restartRequested = true;
  restartAt = millis() + 1200;
}

void saveNetwork() {
  String ssid = configServer.arg("ssid");
  ssid.trim();
  const String password = configServer.arg("password");
  if (ssid.isEmpty()) {
    configServer.send(400, "text/plain; charset=utf-8", "Wi-Fi name is required.");
    return;
  }
  preferences.begin("teng-morse", false);
  preferences.putString("ssid", ssid);
  preferences.putString("password", password);
  preferences.end();
  requestRestart("Wi-Fi details saved.");
}

void forgetNetwork() {
  preferences.begin("teng-morse", false);
  preferences.clear();
  preferences.end();
  requestRestart("Saved Wi-Fi details removed. The setup network will return after restart.");
}

void startConfigurationServer() {
  configServer.on("/", HTTP_GET, sendSetupPage);
  configServer.on("/save", HTTP_POST, saveNetwork);
  configServer.on("/forget", HTTP_POST, forgetNetwork);
  configServer.onNotFound([]() { configServer.sendHeader("Location", "/"); configServer.send(302, "text/plain", ""); });
  configServer.begin();
}

bool heldBootDuringStartup() {
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  const unsigned long deadline = millis() + 1800;
  while (millis() < deadline) {
    if (digitalRead(BOOT_BUTTON_PIN) == LOW) return true;
    delay(10);
  }
  return false;
}

bool connectSavedNetwork() {
  preferences.begin("teng-morse", true);
  const String ssid = preferences.getString("ssid", "");
  const String password = preferences.getString("password", "");
  preferences.end();
  if (ssid.isEmpty()) return false;

  Serial.printf("Connecting to %s", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), password.c_str());
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    Serial.print('.');
    delay(250);
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void startSetupAccessPoint() {
  setupMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAP(CONFIG_AP_SSID, CONFIG_AP_PASSWORD);
  startConfigurationServer();
  Serial.println("Wi-Fi setup mode started.");
  Serial.printf("Connect to %s (password: %s)\n", CONFIG_AP_SSID, CONFIG_AP_PASSWORD);
  Serial.printf("Then open http://%s\n", WiFi.softAPIP().toString().c_str());
}

void startStreamingServices() {
  setupMode = false;
  startConfigurationServer();
  streamServer.begin();
  streamServerStarted = true;
  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("http", "tcp", STREAM_PORT);
    Serial.printf("mDNS stream: http://%s.local:%u/events\n", MDNS_HOSTNAME, STREAM_PORT);
  } else {
    Serial.println("mDNS unavailable; use the numeric IP below.");
  }
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
  Serial.printf("SSE stream: http://%s:%u/events\n", WiFi.localIP().toString().c_str(), STREAM_PORT);
  Serial.printf("Wi-Fi settings: http://%s/\n", WiFi.localIP().toString().c_str());
}

void acceptStreamClient() {
  if (!streamServerStarted) return;
  WiFiClient candidate = streamServer.available();
  if (!candidate) return;

  candidate.setTimeout(150);
  const String requestLine = candidate.readStringUntil('\n');
  while (candidate.connected()) {
    const String header = candidate.readStringUntil('\n');
    if (header == "\r" || header.isEmpty()) break;
  }
  if (!requestLine.startsWith("GET /events ")) {
    candidate.print("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    candidate.stop();
    return;
  }
  if (streamClient && streamClient.connected()) streamClient.stop();
  streamClient = candidate;
  streamClient.setNoDelay(true);
  streamClient.print("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache, no-transform\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\nX-Accel-Buffering: no\r\n\r\n");
  streamClient.print("retry: 1000\n\n");
  Serial.println("Dashboard connected to SSE stream.");
}

void streamReading() {
  if (!streamClient || !streamClient.connected()) return;
  char event[112];
  const int size = snprintf(event, sizeof(event),
    "event: reading\ndata: {\"voltage\":%.4f,\"millivolts\":%lu,\"receivedAt\":%lu}\n\n",
    latestVoltage, static_cast<unsigned long>(latestMillivolts), millis());
  if (size > 0 && size < static_cast<int>(sizeof(event))) {
    streamClient.write(reinterpret_cast<const uint8_t *>(event), size);
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(SENSOR_PIN, ADC_2_5db);
  delay(100);
  latestVoltage = readVoltage();
  latestMillivolts = static_cast<uint32_t>(latestVoltage * 1000.0f + 0.5f);

  Serial.println("\nTENG Morse universal streamer");
  if (heldBootDuringStartup()) {
    Serial.println("BOOT button detected: opening Wi-Fi setup mode.");
    startSetupAccessPoint();
  } else if (connectSavedNetwork()) {
    startStreamingServices();
  } else {
    Serial.println("No saved network or connection timed out.");
    startSetupAccessPoint();
  }
}

void loop() {
  const unsigned long now = millis();
  configServer.handleClient();
  if (restartRequested && now >= restartAt) ESP.restart();

  if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = now;
    latestVoltage = readVoltage();
    latestMillivolts = static_cast<uint32_t>(latestVoltage * 1000.0f + 0.5f);
    Serial.println(latestVoltage, 4);
  }

  if (!setupMode && WiFi.status() != WL_CONNECTED && now - lastReconnectAttemptAt >= 10000) {
    lastReconnectAttemptAt = now;
    WiFi.reconnect();
    Serial.println("Wi-Fi reconnect requested.");
  }
  acceptStreamClient();
  if (now - lastStreamAt >= STREAM_INTERVAL_MS) {
    lastStreamAt = now;
    streamReading();
  }
}
