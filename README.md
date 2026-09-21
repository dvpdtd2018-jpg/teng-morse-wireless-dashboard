# TENG Morse Wireless Dashboard

An ESP32 DevKit V1 project that reads a conditioned CS-TENG voltage signal, sends it wirelessly over Wi-Fi, plots it in a browser, and turns threshold-based taps into Morse code. The dashboard runs on the computer; the ESP32 only provides a lightweight data stream.

The project is portable across routers and phone hotspots. Wi-Fi details are saved on the ESP32 during a one-time setup and are not stored in this repository.

## What it does

- Reads raw GPIO 34 (`ADC1_CH6`) voltage with `analogReadMilliVolts()`.
- Samples at 100 Hz, prints raw voltage to Serial Monitor at 115200 baud, and sends a persistent SSE stream at 50 Hz.
- Provides Raw, EMA smoothing, median-of-5 spike guard, and mean-of-5 noise-average channels in the browser.
- Includes adjustable graph axes, threshold hysteresis, interactive Morse prediction, undo, and clear-message controls.
- Recognizes a double short press as **HUNGRY** and a five-second hold as a doctor-assistance alert.
- Works with an ESP32 powered from a suitable battery supply once it joins the same Wi-Fi network as the computer.

## Hardware safety

```text
Conditioned CS-TENG output  ─── GPIO 34
Signal reference / return   ─── ESP32 GND
```

GPIO 34 must always remain between **0 V and 3.3 V**. A raw TENG can create high-voltage and negative pulses, so use suitable external conditioning/protection before connecting it to the ESP32. Do not use the TENG signal itself to power the ESP32.

For battery power, use a stable regulated 5 V supply at the DevKit `5V/VIN` pin, or a clean regulated 3.3 V supply at `3V3`.

## Repository layout

```text
dashboard/                                      Local browser dashboard
firmware/esp32_teng_universal_sse_streamer/    ESP32 firmware
platformio.ini                                  PlatformIO configuration
```

## English setup

### 1. Install the tools

- Install [Arduino IDE](https://www.arduino.cc/en/software) and the **esp32 by Espressif Systems** board package, or use PlatformIO with the included `platformio.ini`.
- Install Node.js 18 or later on the computer that will display the dashboard.

### 2. Upload the ESP32 firmware

1. Open `firmware/esp32_teng_universal_sse_streamer/esp32_teng_universal_sse_streamer.ino`.
2. Select **ESP32 Dev Module** (or your ESP32 DevKit V1 board) and the correct serial port.
3. Upload the sketch.
4. Open Serial Monitor at **115200 baud**.

### 3. Connect the ESP32 to any Wi-Fi or hotspot

On its first start, or whenever it cannot connect to its saved network, the ESP32 creates this temporary setup network:

```text
Network name: TENG-Morse-Setup
Password:     morse123
```

1. Connect a phone or computer to `TENG-Morse-Setup`.
2. Open [http://192.168.4.1](http://192.168.4.1).
3. Enter the name and password of the router or hotspot that **both the ESP32 and dashboard computer will use**.
4. Save. The ESP32 restarts and prints its IP address in Serial Monitor.

The default browser stream address is:

```text
http://teng-morse.local:81/events
```

If your router/hotspot does not support `.local` device names, use the numeric stream address printed by Serial Monitor instead, for example `http://192.168.1.42:81/events`.

### 4. Start the dashboard on the computer

From the repository folder, run:

```bash
npm start
```

Then open [http://localhost:3001](http://localhost:3001).

The dashboard starts with `teng-morse.local` automatically. If it shows **RETRYING**, paste the ESP32's numeric address into **ESP32 stream → Data address**, then choose **Connect to ESP32**. The address is remembered in that browser.

### 5. Tune the signal and Morse decoder

For an observed firm press around 250–270 mV, start with:

```text
Y-axis maximum:       0.300 V
Signal channel:       Spike guard · median of 5
Threshold center:     0.200 V
Hysteresis:           20 mV
```

This requires about 0.210 V to enter a press and 0.190 V to release it. If your resting signal is different, place the center threshold roughly halfway between the resting level and a normal press.

Try the signal channels in this order:

1. **Raw** to understand the actual signal.
2. **Spike guard** for occasional sharp noise spikes; it adds about 40 ms delay.
3. **Smooth** for continuous jitter with little delay.
4. **Noise average** for the smoothest trace; very short taps may become softer.

The selected channel controls both the chart and Morse trigger. Use **Undo** or **Clear message** to manage decoded text without interrupting the stream.

### Special care gestures

Special gestures work only while the voltage threshold is enabled, and take priority over the active Morse character.

- **HUNGRY:** make two short threshold presses. The second release must occur within one second of the first release. The decoded display is replaced with `HUNGRY`.
- **DOCTOR:** hold the signal continuously above the threshold for five seconds. The display changes to `CALL DOCTOR` and the dashboard shows a persistent red assistance alert.

Enter the doctor's number in the alert card before it is needed. The dashboard saves it only in that browser. The alert provides a `tel:` call button that you must click to confirm the call; browsers intentionally do not allow an incoming sensor stream to place a telephone call automatically.

### Change Wi-Fi later

While the ESP32 is on its current network, open `http://teng-morse.local/` or its numeric IP address in a browser, save the new network, and reconnect the computer to that same network.

If the old network is unavailable, reset the ESP32 normally, then hold the **BOOT** button at any point during the first two seconds after startup. It will return to `TENG-Morse-Setup` mode. Do not hold BOOT while pressing reset, because that can enter the ESP32 download mode.

### Troubleshooting

| Problem | Check |
| --- | --- |
| Dashboard says `RETRYING` | Computer and ESP32 must be on the same router/hotspot. Enter the numeric stream URL from Serial Monitor. |
| `teng-morse.local` does not open | Some hotspots do not forward `.local` names. Use the ESP32 IP instead. |
| ESP32 cannot join phone hotspot | ESP32 requires 2.4 GHz Wi-Fi. On iPhone, enable **Maximize Compatibility**. |
| Readings are unstable | Check the common GND, input conditioning, cable length, and try Spike guard or hysteresis. |
| No voltage response | Confirm the conditioned signal is on GPIO 34, not GPIO 39, and remains inside 0–3.3 V. |

## Hướng dẫn tiếng Việt

### 1. Cài đặt công cụ

- Cài [Arduino IDE](https://www.arduino.cc/en/software) và board package **esp32 by Espressif Systems**, hoặc dùng PlatformIO với file `platformio.ini` có sẵn.
- Máy tính hiển thị dashboard cần Node.js phiên bản 18 trở lên.

### 2. Nạp firmware cho ESP32

1. Mở file `firmware/esp32_teng_universal_sse_streamer/esp32_teng_universal_sse_streamer.ino`.
2. Chọn board **ESP32 Dev Module** (hoặc ESP32 DevKit V1) và đúng cổng serial.
3. Upload chương trình.
4. Mở Serial Monitor với baud rate **115200**.

### 3. Kết nối ESP32 với bất kỳ Wi-Fi hoặc hotspot nào

Lần khởi động đầu tiên, hoặc khi không kết nối được mạng đã lưu, ESP32 sẽ tạo mạng cài đặt tạm thời:

```text
Tên mạng: TENG-Morse-Setup
Mật khẩu: morse123
```

1. Kết nối điện thoại hoặc máy tính với `TENG-Morse-Setup`.
2. Mở [http://192.168.4.1](http://192.168.4.1).
3. Nhập tên và mật khẩu của Wi-Fi/hotspot mà **ESP32 và máy tính dashboard cùng sử dụng**.
4. Bấm lưu. ESP32 sẽ khởi động lại và in địa chỉ IP trên Serial Monitor.

Địa chỉ stream mặc định là:

```text
http://teng-morse.local:81/events
```

Nếu hotspot/router không hỗ trợ tên `.local`, hãy dùng địa chỉ IP mà Serial Monitor in ra, ví dụ `http://192.168.1.42:81/events`.

### 4. Chạy dashboard trên máy tính

Mở Terminal trong thư mục repository và chạy:

```bash
npm start
```

Sau đó mở [http://localhost:3001](http://localhost:3001).

Dashboard tự dùng `teng-morse.local`. Nếu trạng thái hiện **RETRYING**, dán địa chỉ IP stream của ESP32 vào mục **ESP32 stream → Data address**, rồi bấm **Connect to ESP32**. Trình duyệt sẽ nhớ địa chỉ này.

### 5. Chỉnh tín hiệu và giải mã Morse

Với lực nhấn tạo điện áp khoảng 250–270 mV, có thể bắt đầu với:

```text
Y-axis maximum:       0.300 V
Signal channel:       Spike guard · median of 5
Threshold center:     0.200 V
Hysteresis:           20 mV
```

Thiết lập này kích hoạt khi điện áp lớn hơn khoảng 0.210 V và nhả khi nhỏ hơn khoảng 0.190 V. Nếu điện áp nền khác, đặt ngưỡng ở khoảng giữa điện áp nghỉ và điện áp nhấn bình thường.

Thử các kênh theo thứ tự sau:

1. **Raw** để xem tín hiệu thực.
2. **Spike guard** để bỏ các xung nhiễu đơn lẻ; có độ trễ khoảng 40 ms.
3. **Smooth** để làm mượt nhiễu liên tục với độ trễ nhỏ.
4. **Noise average** để có đường biểu diễn mượt nhất; các lần chạm rất ngắn có thể bị giảm biên độ.

Kênh đang chọn điều khiển cả biểu đồ lẫn ngưỡng Morse. Dùng **Undo** hoặc **Clear message** để chỉnh nội dung đã giải mã mà không ngắt kết nối.

### Thao tác chăm sóc đặc biệt

Các thao tác đặc biệt chỉ hoạt động khi đã bật ngưỡng điện áp và được ưu tiên hơn ký tự Morse đang nhập.

- **HUNGRY:** nhấn ngắn hai lần. Lần nhả thứ hai phải diễn ra trong vòng một giây kể từ lần nhả đầu tiên. Màn hình giải mã sẽ chuyển thành `HUNGRY`.
- **DOCTOR:** giữ tín hiệu liên tục trên ngưỡng trong năm giây. Màn hình chuyển thành `CALL DOCTOR` và dashboard hiện cảnh báo hỗ trợ màu đỏ.

Nhập số điện thoại bác sĩ vào thẻ cảnh báo trước khi cần dùng. Số này chỉ được lưu trong trình duyệt đó. Nút `tel:` chỉ thực hiện cuộc gọi sau khi bạn bấm xác nhận; trình duyệt chủ động không cho phép tín hiệu cảm biến tự động gọi điện để tránh cuộc gọi ngoài ý muốn.

### Đổi Wi-Fi/hotspot

Khi ESP32 vẫn còn trên mạng cũ, mở `http://teng-morse.local/` hoặc địa chỉ IP của ESP32, lưu mạng mới, rồi kết nối máy tính vào cùng mạng đó.

Nếu không còn truy cập được mạng cũ, khởi động lại ESP32 bình thường rồi giữ nút **BOOT** vào bất kỳ lúc nào trong hai giây đầu sau khi khởi động. ESP32 sẽ quay lại mạng `TENG-Morse-Setup`. Không giữ BOOT trong lúc nhấn reset vì ESP32 có thể vào chế độ nạp chương trình.

### Khắc phục lỗi

| Vấn đề | Kiểm tra |
| --- | --- |
| Dashboard hiện `RETRYING` | ESP32 và máy tính phải dùng cùng Wi-Fi/hotspot. Dùng URL IP từ Serial Monitor. |
| Không mở được `teng-morse.local` | Một số hotspot không hỗ trợ `.local`; hãy dùng IP của ESP32. |
| ESP32 không vào được hotspot điện thoại | ESP32 cần Wi-Fi 2.4 GHz. Với iPhone, bật **Maximize Compatibility**. |
| Tín hiệu không ổn định | Kiểm tra GND chung, mạch bảo vệ/điều hòa tín hiệu, dây dẫn, rồi thử Spike guard hoặc hysteresis. |
| Không thấy điện áp thay đổi | Kiểm tra tín hiệu đã được điều hòa đi vào GPIO 34, không phải GPIO 39, và luôn nằm trong 0–3.3 V. |

## PlatformIO commands

```bash
pio run
pio run --target upload
pio device monitor --baud 115200
```
