# dsh-plugin-lily-voice

给 [DSH](https://github.com/deepseek-ai) Web GUI 用的**中文语音面板**：常驻听麦、实时转写、本地同音纠错、手动确认/改正并沉淀词表、发送框旁的录音状态灯，以及语音播报。

> 全部在本机跑完：whisper 本地转写 + 本地词表纠错 + 本地/edge TTS，不把语音上传到任何服务器。

## 功能

| 模块 | 说明 |
|---|---|
| 常驻监听 | 侧栏「莉莉语音」页一键开/关，后台跑 `talk.py listen-daemon`，读到静止 1.5 秒算一句结束，判句后冷却 3 秒再收下一句 |
| 听到的话 | 每 2 秒轮询，按时间列出（时间 / 时长 / 文字 / 置信度 / 声纹相似度） |
| 手动改正 | 每行「改正」：把听错的句子改成正确写法，自动拆成词对写进词表；下次同样的错本地直接改对 |
| 确认 | 每行「确认」：这句话没说错，记进提示词（whisper `initial_prompt`），且禁止再被自动改；已改正过的行确认按钮自动禁用，防重复入表 |
| 删除 | 删除记录，并联动撤掉这条学到的词对 / 整句条目 / 热词 |
| 纠错词表 | 手动增删词对；「改正」也会自动写进来 |
| 录音状态灯 | 发送框「纠错」右边：说话时红点闪「录音中」，安静时灰点「待机」，转写/冷却为黄点；我播报时不亮 |
| 语音播报 | 面板里输入文字让我念；音色可切网络（edge，自然）或本机（SAPI，免费） |

## 组成

- **宿主半边** `lib/index.js`：cordis 插件，`inject: ["webServer"]`，注册 loopback-only 路由
  - `GET  /api/dsh-lily-voice/status`
  - `POST /api/dsh-lily-voice/start` / `stop`
  - `GET  /api/dsh-lily-voice/heard?n=60`
  - `POST /api/dsh-lily-voice/say` `{text}`
  - `GET  /api/dsh-lily-voice/voices`、`GET|POST /api/dsh-lily-voice/config`
- **浏览器半边** `lib/client.js`：`window.__ModuleLoader__.load({ id, factory })`，注册侧栏行（`sidebar.panellist`）、整页（`main`）与发送框旁两个小组件（`conversation.input.right`）
- **本机控制口**：`talk.py` 自带 `127.0.0.1:20129` 控制口（带 CORS），浏览器按钮直接读写 `voice_cfg.json` 与词表，不用重启 DSH
  - `GET /state` `/correct` `/table` `/learned` `/confirmed`
  - `POST /correct` `/learn` `/confirm` `/table` `/heard/delete`
- **selftest.mjs**：不装进 DSH 也能跑服务端路由自测（mock ctx / webServer）

## 运行依赖（本机工具链）

| 依赖 | 说明 |
|---|---|
| Python 3.10+ | 需装 `faster-whisper`、`sounddevice`、`numpy`、`edge-tts`、`pypinyin` |
| `talk.py` | 本插件调用它的 `say` / `listen-daemon` 子命令 |
| `voice.py` | 录音、VAD、声纹校验、TTS、配置读写 |

默认路径（作者本机）：

```
TOOLS  = D:\Program Files\deepseek H Wokr\工具
PYTHON = D:\DSH-Data\dsh-home\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe
```

其它机器用环境变量覆盖即可：

```powershell
$env:LILY_TOOLS  = "D:\tools"          # 其下需有 senses\talk.py、senses\voice.py
$env:LILY_PYTHON = "C:\Python312\python.exe"
```

## 安装

```powershell
# 从 git 仓库
& "<DSH>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add git+https://github.com/<owner>/dsh-plugin-lily-voice.git

# 或本地目录
& "<DSH>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add file:"<本地路径>"
```

装完确认 profile 的 `package.json` 里包名同时出现在 `dependencies` 与 `dsh.profile.bundles`，然后重启 DSH。侧栏会出现「莉莉语音」。

## 配置（`工具\senses\voice_cfg.json`）

| 键 | 默认 | 说明 |
|---|---|---|
| `engine` | `"edge"` | `edge` 网络音色 / `sapi` 本机音色 |
| `voice` | `"zh-CN-XiaoxiaoNeural"` | edge 音色名 |
| `sapi_voice` | `"Huihui"` | 本机音色名 |
| `correct` | `true` | 纠错总开关（等价发送框旁「● 纠错」） |
| `correct_llm` | `false` | 是否额外用免费模型纠错（需自备 key，默认只本地） |
| `correct_backends` | `["zhipu"]` | 模型通道顺序 |
| `silence` | `1.5` | 静音多少秒判一句结束 |
| `cooldown` | `3.0` | 判句后暂停多少秒再收音 |
| `vp_thresh` | `0.32` | 声纹相似度门槛（短句 <3 秒自动再减 0.04） |

## 数据文件（`工具\senses\`）

| 文件 | 内容 |
|---|---|
| `heard.jsonl` | 听到的话（含 `fix` 纠错信息、`vp` 声纹相似度） |
| `heard_ignored.jsonl` | 被丢弃的声音及原因（`voiceprint(x.xx)` / `self-talk`） |
| `fix_table.json` | 同音错词表 `{错词: 正确词}` |
| `fix_phrases.json` | 整句表（只在完全相同的句子时生效） |
| `vocab.txt` | 热词（喂给 whisper 的 `initial_prompt`） |
| `confirmed.jsonl` | 已确认没Listening错的句子 |
| `learned.jsonl` | 每次「改正」的审计记录 |
| `rec_state.json` | 当前录音状态（供状态灯读取） |

## 诚实边界

- **两套麦克风链路别同时开**：本插件与 DSH 自带「语音输入（实验性）」会抢麦，转写会互相打架
- 关掉模型通道（默认）后，**没见过的错字不会修**；词表只对之后生效，不回改历史
- 声纹门槛太低会把自己的播报放进来，太高会吞掉轻声短句（默认 0.32 是折中）
- whisper base 在安静环境、3 秒以上句子最准；短句、方言、多人同时说话会糊
- Windows 专用（用 `sounddevice` + Win32 设备名 + SAPI 音色）

## License

MIT
