window.__ModuleLoader__.load({
  id: "dsh-plugin-lily-voice",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useCallback = React.useCallback;

    /** 面板 id，侧栏行与主区共用。 */
    var PANEL_ID = "lily-voice";
    var PANEL_ORDER = 40;

    /** 文档相对路径（宿主用 <base href="./">，不能写根绝对路径）。 */
    var API = {
      status: "api/dsh-lily-voice/status",
      heard: "api/dsh-lily-voice/heard",
      start: "api/dsh-lily-voice/start",
      stop: "api/dsh-lily-voice/stop",
      say: "api/dsh-lily-voice/say",
      config: "api/dsh-lily-voice/config",
      voices: "api/dsh-lily-voice/voices",
      active: "api/dsh-lily-voice/active"
    };

    /** 纠错开关走 talk.py 自己的控制口（只绑 127.0.0.1），改完不用重启 DSH 宿主。 */
    var CTRL_BASE = "http://127.0.0.1:20129";
    var CTRL_URL = CTRL_BASE + "/correct";

    /** 统一 fetch：返回 JSON，失败抛错。 */
    async function call(url, init) {
      var res = await fetch(url, init);
      var data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
      if (!res.ok) {
        var msg = data && data.error ? data.error : "HTTP " + res.status;
        throw new Error(msg);
      }
      return data;
    }

    function postJson(url, body) {
      return call(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {})
      });
    }

    // ------------------------------------------------------------------ 样式
    var S = {
      wrap: { padding: "18px 22px", color: "var(--dsh-text-primary, #e6e6e6)", fontSize: "13px", lineHeight: 1.55, height: "100%", overflow: "auto" },
      title: { fontSize: "16px", fontWeight: 600, margin: "0 0 4px" },
      sub: { opacity: 0.6, marginBottom: "16px" },
      card: { border: "1px solid rgba(255,255,255,0.10)", borderRadius: "10px", padding: "12px 14px", marginBottom: "12px", background: "rgba(255,255,255,0.03)" },
      row: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
      dot: function (on) {
        return {
          width: "9px", height: "9px", borderRadius: "50%",
          background: on ? "#2ecc71" : "#888",
          boxShadow: on ? "0 0 8px #2ecc71" : "none",
          display: "inline-block"
        };
      },
      btn: function (primary) {
        return {
          padding: "5px 14px", borderRadius: "7px", cursor: "pointer", fontSize: "12px",
          border: "1px solid " + (primary ? "transparent" : "rgba(255,255,255,0.18)"),
          background: primary ? "#2f6feb" : "rgba(255,255,255,0.06)",
          color: primary ? "#fff" : "inherit"
        };
      },
      btnOk: function () {
        return {
          padding: "5px 12px", borderRadius: "7px", cursor: "pointer", fontSize: "12px",
          border: "1px solid rgba(46,204,113,0.45)", background: "rgba(46,204,113,0.10)",
          color: "#2ecc71"
        };
      },
      okTag: {
        fontSize: "11px", padding: "2px 7px", borderRadius: "5px",
        background: "rgba(46,204,113,0.14)", color: "#2ecc71"
      },
      btnOff: function () {
        return {
          padding: "5px 12px", borderRadius: "7px", cursor: "not-allowed", fontSize: "12px",
          border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)",
          color: "rgba(255,255,255,0.28)"
        };
      },
      btnDanger: function () {
        return {
          padding: "5px 12px", borderRadius: "7px", cursor: "pointer", fontSize: "12px",
          border: "1px solid rgba(255,107,107,0.45)", background: "rgba(255,107,107,0.10)",
          color: "#ff8b8b"
        };
      },
      input: { flex: 1, minWidth: "180px", padding: "6px 10px", borderRadius: "7px", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.25)", color: "inherit", fontSize: "12px" },
      select: { padding: "5px 8px", borderRadius: "7px", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.35)", color: "inherit", fontSize: "12px" },
      list: { maxHeight: "46vh", overflow: "auto", marginTop: "8px" },
      item: { display: "flex", gap: "10px", padding: "6px 4px", borderBottom: "1px solid rgba(255,255,255,0.06)" },
      time: { opacity: 0.55, fontVariantNumeric: "tabular-nums", minWidth: "58px" },
      tag: { opacity: 0.45, fontSize: "11px", minWidth: "56px" },
      fixedTag: {
        marginLeft: "6px", fontSize: "11px", padding: "1px 6px", borderRadius: "5px",
        background: "rgba(46,204,113,0.16)", color: "#2ecc71"
      },
      err: { color: "#ff6b6b", fontSize: "12px", marginTop: "6px" }
    };

    // ------------------------------------------------------------------ 图标
    function LilyVoiceIcon(props) {
      var active = props && props.active;
      return h("svg", {
        width: 18, height: 18, viewBox: "0 0 24 24", fill: "none",
        stroke: "currentColor", strokeWidth: 1.8,
        strokeLinecap: "round", strokeLinejoin: "round",
        style: { opacity: active ? 1 : 0.8 }
      },
        h("rect", { x: 9, y: 2.5, width: 6, height: 11, rx: 3 }),
        h("path", { d: "M5.5 11a6.5 6.5 0 0 0 13 0" }),
        h("line", { x1: 12, y1: 17.5, x2: 12, y2: 21 })
      );
    }

    // ------------------------------------------------------------------ 面板
    function LilyVoicePage() {
      var _status = useState(null);
      var status = _status[0], setStatus = _status[1];
      var _heard = useState([]);
      var heard = _heard[0], setHeard = _heard[1];
      var _voices = useState({ edge: [], sapi: [] });
      var voices = _voices[0], setVoices = _voices[1];
      var _text = useState("");
      var text = _text[0], setText = _text[1];
      var _busy = useState("");
      var busy = _busy[0], setBusy = _busy[1];
      var _err = useState("");
      var err = _err[0], setErr = _err[1];
      var _editKey = useState("");
      var editKey = _editKey[0], setEditKey = _editKey[1];
      var _editText = useState("");
      var editText = _editText[0], setEditText = _editText[1];
      var _note = useState("");
      var note = _note[0], setNote = _note[1];
      var _tbl = useState(null);
      var tbl = _tbl[0], setTbl = _tbl[1];
      var _tblOpen = useState(false);
      var tblOpen = _tblOpen[0], setTblOpen = _tblOpen[1];
      var _introOpen = useState(true);
      var introOpen = _introOpen[0], setIntroOpen = _introOpen[1];
      var _tblRows = useState({});
      var tblRows = _tblRows[0], setTblRows = _tblRows[1];
      var _addFrom = useState("");
      var addFrom = _addFrom[0], setAddFrom = _addFrom[1];
      var _addTo = useState("");
      var addTo = _addTo[0], setAddTo = _addTo[1];
      var _tblMsg = useState("");
      var tblMsg = _tblMsg[0], setTblMsg = _tblMsg[1];
      // 手动改正的历史 {原句: 正确句}，用来在每一行显示「错误 → 正确」对比
      var _corr = useState({});
      var corr = _corr[0], setCorr = _corr[1];
      // 点过「确认」的句子（说明没说错），显示成绿勾
      var _okTexts = useState({});
      var okTexts = _okTexts[0], setOkTexts = _okTexts[1];
      // 实时录音状态 {phase:"listening|transcribing|cooldown", speaking:bool}
      var _rec = useState(null);
      var rec = _rec[0], setRec = _rec[1];

      /** 拉「确认无误」的句子列表。 */
      var loadConfirmed = useCallback(async function () {
        try {
          var d = await call(CTRL_BASE + "/confirmed");
          var map = {};
          ((d && d.texts) || []).forEach(function (t) { map[t] = true; });
          setOkTexts(map);
        } catch (e) { /* 控制口没起时忽略 */ }
      }, []);

      /** 拉手动改正的历史，列表里好显示「错误 → 正确」。 */
      var loadLearned = useCallback(async function () {
        try {
          var d = await call(CTRL_BASE + "/learned");
          setCorr((d && d.corrections) || {});
        } catch (e) { /* 控制口没起时忽略，不影响列表 */ }
      }, []);

      var refresh = useCallback(async function () {
        try {
          var st = await call(API.status);
          setStatus(st);
          var hd = await call(API.heard + "?n=60");
          setHeard(hd.rows || []);
          loadLearned();
          loadConfirmed();
          setErr("");
        } catch (e) {
          setErr(String(e.message || e));
        }
      }, [loadLearned, loadConfirmed]);

      useEffect(function () {
        var alive = true;
        call(API.voices).then(function (v) { if (alive) setVoices(v); }).catch(function () {});
        fetch(CTRL_BASE + "/table").then(function (r) { return r.json(); })
          .then(function (d) { if (alive && d) setTbl(d.count); }).catch(function () {});
        refresh();
        var timer = setInterval(function () { if (alive) refresh(); }, 2000);
        return function () { alive = false; clearInterval(timer); };
      }, [refresh]);

      // 录音状态：400ms 问一次控制口，红点跟着你说话亮灭
      useEffect(function () {
        var alive = true;
        var tick = function () {
          fetch(CTRL_BASE + "/state").then(function (r) { return r.json(); })
            .then(function (d) { if (alive) setRec(d); })
            .catch(function () { if (alive) setRec(null); });
        };
        tick();
        var tm = setInterval(tick, 400);
        return function () { alive = false; clearInterval(tm); };
      }, []);

      /** 读整张本地词表（展开管理时才拉）。 */
      var loadTable = useCallback(async function () {
        try {
          var d = await call(CTRL_BASE + "/table");
          setTblRows((d && d.fixes) || {});
          if (d && typeof d.count === "number") setTbl(d.count);
        } catch (e) {
          setTblMsg("读不到词表：" + String(e.message || e));
        }
      }, []);

      var addPair = useCallback(async function () {
        var a = addFrom.trim();
        var b = addTo.trim();
        if (!a || !b) { setTblMsg("错词和正确词都要填"); return; }
        setBusy("tbl");
        try {
          await call(CTRL_BASE + "/table", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ add: { from: a, to: b } })
          });
          setAddFrom("");
          setAddTo("");
          setTblMsg("已添加：" + a + " → " + b);
          await loadTable();
        } catch (e) {
          setTblMsg(String(e.message || e));
        } finally {
          setBusy("");
        }
      }, [addFrom, addTo, loadTable]);

      var delPair = useCallback(async function (key) {
        setBusy("tbl");
        try {
          await call(CTRL_BASE + "/table", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ delete: key })
          });
          setTblMsg("已删除：" + key);
          await loadTable();
        } catch (e) {
          setTblMsg(String(e.message || e));
        } finally {
          setBusy("");
        }
      }, [loadTable]);

      var toggleTable = function () {
        var open = !tblOpen;
        setTblOpen(open);
        setTblMsg("");
        if (open) loadTable();
      };

      /** 记一句手动改正：写进 fix_table.json / 整句表，新的对词也补进热词。 */
      var rowKey = function (row) { return (row.t || "") + "|" + (row.text || ""); };
      // 最近这些句子的平均转写耗时，给「说明」里的时间周期用
      var secsList = heard.map(function (r) { return r.secs; })
        .filter(function (v) { return typeof v === "number" && v > 0 && v < 60; });
      var avgSecs = secsList.length
        ? secsList.reduce(function (a, b) { return a + b; }, 0) / secsList.length
        : 0;
      var startEdit = function (row) {
        setEditKey(rowKey(row));
        setEditText(row.text || "");
        setNote("");
      };
      var cancelEdit = function () { setEditKey(""); };
      var learn = useCallback(async function (row) {
        var fixed = editText.trim();
        if (!fixed || fixed === row.text) { setEditKey(""); return; }
        setBusy("learn");
        try {
          var d = await call(CTRL_BASE + "/learn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ raw: row.text, corrected: fixed })
          });
          var pairs = (d && d.pairs) || [];
          setNote(d && d.phrase
            ? "已记整句：" + fixed
            : "已记入词表：" + (pairs.map(function (p) { return p[0] + "→" + p[1]; }).join("，") || "没有可拆的词对"));
          if (d && typeof d.table === "number") setTbl(d.table);
          setEditKey("");
          await refresh();
        } catch (e) {
          setErr(String(e.message || e));
        } finally {
          setBusy("");
        }
      }, [editText, refresh]);

      /** 这句话没说错：记进 confirmed.jsonl，后面 whisper 的提示词会带上它。 */
      var confirmRow = useCallback(async function (row) {
        setBusy("ok");
        try {
          var d = await call(CTRL_BASE + "/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: row.text || "" })
          });
          setNote("已确认没说错（累计 " + ((d && d.count) || 0) + " 句）；下次转写会带着这些句子做参考");
          await refresh();
        } catch (e) {
          setErr(String(e.message || e));
        } finally {
          setBusy("");
        }
      }, [refresh]);

      /** 删掉这一条听到的话（只删 heard.jsonl 记录，不动词表）。 */
      var deleteRow = useCallback(async function (row) {
        setBusy("del");
        try {
          var d = await call(CTRL_BASE + "/heard/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ t: row.t || "", text: row.text || "" })
          });
          var undo = (d && d.undo) || {};
          var extra = [];
          if (undo.pairs) extra.push("词表 " + undo.pairs + " 条");
          if (undo.phrase) extra.push("整句表 " + undo.phrase + " 条");
          if (undo.vocab) extra.push("热词 " + undo.vocab + " 个");
          setNote("已删除 " + ((d && d.removed) || 0) + " 条记录" +
            (extra.length ? "，同时清掉" + extra.join("、") : "（这句没有改过的词表记录）"));
          setEditKey("");
          await refresh();
        } catch (e) {
          setErr(String(e.message || e));
        } finally {
          setBusy("");
        }
      }, [refresh]);

      var toggle = useCallback(async function () {
        setBusy("toggle");
        try {
          if (status && status.running) await postJson(API.stop, {});
          else await postJson(API.start, {});
          await refresh();
        } catch (e) {
          setErr(String(e.message || e));
        } finally {
          setBusy("");
        }
      }, [status, refresh]);

      var speak = useCallback(async function () {
        var t = text.trim();
        if (!t) return;
        setBusy("say");
        try {
          await postJson(API.say, { text: t });
          setText("");
        } catch (e) {
          setErr(String(e.message || e));
        } finally {
          setBusy("");
        }
      }, [text]);

      var applyVoice = useCallback(async function (engine, voice) {
        setBusy("cfg");
        try {
          await postJson(API.config, { engine: engine, voice: voice });
          await refresh();
        } catch (e) {
          setErr(String(e.message || e));
        } finally {
          setBusy("");
        }
      }, [refresh]);

      var running = !!(status && status.running);
      var cfg = (status && status.cfg) || {};
      var engine = cfg.engine || "edge";
      var voiceList = engine === "sapi" ? voices.sapi || [] : voices.edge || [];

      return h("div", { style: S.wrap },
        h("style", null,
          "@keyframes lilyPulse{0%{opacity:1}50%{opacity:.25}100%{opacity:1}}"),
        h("h2", { style: S.title }, "莉莉语音"),
        h("div", { style: S.sub }, "麦克风监听 · 听到的话 · 语音播报"),

        h("div", { style: S.card },
          h("div", { style: S.row },
            h("span", { style: S.dot(running) }),
            h("strong", null, running ? "监听中" : "已停止"),
            status && status.pid ? h("span", { style: { opacity: 0.5 } }, "pid " + status.pid) : null,
            h("div", { style: { flex: 1 } }),
            h("button", {
              style: S.btn(!running),
              disabled: busy === "toggle",
              onClick: toggle
            }, busy === "toggle" ? "处理中…" : (running ? "停止监听" : "开始监听"))
          ),
          h("div", { style: { opacity: 0.55, marginTop: "8px", fontSize: "12px" } },
            running
              ? "常驻转写模式：听到的话会写进 heard.jsonl；开自动注入后直接变成当前会话里的消息，把莉莉叫醒。"
              : "开启后占用麦克风；配合自动注入，莉莉会在当前打开的会话里直接接手。")
        ),

        h("div", { style: S.card },
          h("div", { style: S.row },
            h("span", { style: { opacity: 0.7 } }, "音色"),
            h("select", {
              style: S.select,
              value: engine,
              onChange: function (e) { applyVoice(e.target.value, cfg.voice); }
            },
              h("option", { value: "edge" }, "网络音色（edge，自然）"),
              h("option", { value: "sapi" }, "本机离线（免费、最快）")
            ),
            h("select", {
              style: S.select,
              value: cfg.voice || (voiceList[0] && voiceList[0].id) || "",
              onChange: function (e) { applyVoice(engine, e.target.value); }
            },
              voiceList.map(function (v) {
                return h("option", { key: v.id, value: v.id }, v.label || v.id);
              })
            ),
            h("button", { style: S.btn(false), disabled: busy === "cfg", onClick: function () { applyVoice(engine, cfg.voice); } }, "保存")
          ),
          engine === "sapi"
            ? h("div", { style: { opacity: 0.5, marginTop: "6px", fontSize: "12px" } }, "离线模式不联网，开口更快（约 3 秒）。")
            : h("div", { style: { opacity: 0.5, marginTop: "6px", fontSize: "12px" } }, "网络音色需要联网合成，延迟约 5 秒。")
        ),

        h("div", { style: S.card },
          h("div", { style: S.row },
            h("input", {
              style: S.input,
              placeholder: "让莉莉说一句话…",
              value: text,
              onChange: function (e) { setText(e.target.value); },
              onKeyDown: function (e) { if (e.key === "Enter") speak(); }
            }),
            h("button", { style: S.btn(true), disabled: busy === "say", onClick: speak }, busy === "say" ? "…" : "说")
          )
        ),

        h("div", { style: S.card },
          h("div", { style: S.row },
            h("strong", null, "说明"),
            h("span", { style: { opacity: 0.5, fontSize: "12px" } }, "应答节奏 · 全部功能"),
            h("div", { style: { flex: 1 } }),
            h("button", { style: S.btn(false), onClick: function () { setIntroOpen(!introOpen); } },
              introOpen ? "收起" : "展开")
          ),
          !introOpen
            ? h("div", { style: { opacity: 0.45, fontSize: "12px", marginTop: "4px" } },
                "点「展开」看应答时间是怎么算的，以及面板上每个按钮管什么。")
            : h("div", { style: { marginTop: "8px", fontSize: "12px", lineHeight: 1.75 } },
                h("div", { style: { fontWeight: 600, marginBottom: "2px" } }, "应答时间周期（一句话从说完到出现在下面）"),
                h("div", null,
                  "① 说完后静音 1.5 秒 → 判定这句结束；" +
                  "② 本机 whisper base 转写，约 1–2 秒" +
                  (avgSecs ? "（最近平均 " + avgSecs.toFixed(1) + " 秒）" : "") + "；" +
                  "③ 本地纠错（词表 + 同音校验，几十毫秒，不联网）；" +
                  "④ 写进 heard.jsonl 并注入当前会话；" +
                  "⑤ 结束后暂停 3 秒再开始收下一句。前半段合计约 2–3 秒。"),
                h("div", { style: { opacity: 0.55, marginTop: "2px" } },
                  "也就是说：你停下 1.5 秒我判句结束，判完再等 3 秒才重新开麦，从你最后一个字到下一轮开始约 4.5 秒。"),
                h("div", { style: { opacity: 0.55, marginTop: "2px" } },
                  "语音播报另算：本机离线音色约 1–2 秒，网络音色（edge）约 5 秒。"),
                h("div", { style: { fontWeight: 600, margin: "8px 0 2px" } }, "全部功能"),
                h("ul", { style: { margin: 0, paddingLeft: "18px" } },
                  h("li", null, "监听开关：开＝持续听麦克风并转写；关＝完全释放麦克风。"),
                  h("li", null, "音色：网络音色（自然、稍慢）或本机离线（免费、更快），「说」可试听。"),
                  h("li", null, "听到的话：每条有「确认 / 改正 / 删除」。确认＝这句没说错（进提示词、禁止再被改）；改正＝手动改成正确句并自动入词表；删除＝删记录并联动撤掉它加的词对。"),
                  h("li", null, "纠错词表：本地同音词表，可手动增删；「改正」和「删除」都会联动它。"),
                  h("li", null, "输入框右下角「● 纠错」：纠错总开关（绿开灰关，灰点＝监听进程没起）。"),
                  h("li", null, "全部在本地完成，不联网、不上传任何语音。")
                )
              )
        ),

        h("div", { style: S.card },
          h("div", { style: S.row },
            h("strong", null, "听到的话"),
            h("span", { style: { opacity: 0.5, fontSize: "12px" } }, heard.length + " 条（最近）"),
            tbl !== null ? h("span", { style: { opacity: 0.45, fontSize: "12px" } }, "纠错词表 " + tbl + " 条") : null,
            h("div", { style: { flex: 1 } }),
            h("button", { style: S.btn(false), onClick: refresh }, "刷新")
          ),
          h("div", { style: { opacity: 0.5, fontSize: "12px", marginTop: "4px" } },
            "听到错的句子就点「改正」，改成你要的样子并记入词表；下次同样的错会本地自动改对，不联网。"),
          h("div", { style: S.list },
            heard.length === 0
              ? h("div", { style: { opacity: 0.45, padding: "10px 4px" } }, "还没有记录。")
              : heard.slice().reverse().map(function (row, i) {
                var editing = editKey === rowKey(row);
                return h("div", { key: i, style: S.item },
                  h("span", { style: S.time }, row.t || "--:--:--"),
                  h("span", { style: S.tag }, (row.dur || 0) + "s"),
                  editing
                    ? h("input", {
                        style: S.input,
                        value: editText,
                        autoFocus: true,
                        onChange: function (e) { setEditText(e.target.value); },
                        onKeyDown: function (e) {
                          if (e.key === "Enter") learn(row);
                          if (e.key === "Escape") cancelEdit();
                        }
                      })
                    : (function () {
                        // 手动改正过：显示「错误句 → 正确句」；自动纠错过：显示带删除线的原句
                        var fixedByHand = corr[row.text || ""];
                        var autoRaw = row.fix && row.fix.raw && row.fix.raw !== row.text ? row.fix.raw : "";
                        if (fixedByHand) {
                          return h("span", { style: { flex: 1 } },
                            h("span", { style: { opacity: 0.55, textDecoration: "line-through" } }, row.text || ""),
                            h("span", { style: { margin: "0 6px", color: "#2ecc71" } }, "→"),
                            h("span", { style: { color: "#2ecc71" } }, fixedByHand),
                            h("span", { style: S.fixedTag }, "已改正")
                          );
                        }
                        if (autoRaw) {
                          return h("span", { style: { flex: 1 } },
                            h("span", { style: { color: "#2ecc71" } }, row.text || ""),
                            h("span", { style: { opacity: 0.5, fontSize: "12px", marginLeft: "8px" } }, "（原文：" + autoRaw + "）")
                          );
                        }
                        return h("span", { style: { flex: 1 } }, row.text || "");
                      })(),
                  editing
                    ? null
                    : (okTexts[row.text || ""]
                        ? h("span", { style: S.okTag }, "✓ 已确认")
                        : (corr[row.text || ""]
                            ? h("button", {
                                style: S.btnOff(),
                                disabled: true,
                                title: "这句已经点过「改正」并入过词表，不能再确认，免得重复入表"
                              }, "确认")
                            : h("button", { style: S.btnOk(), disabled: busy === "ok", onClick: function () { confirmRow(row); } }, busy === "ok" ? "…" : "确认"))),
                  editing
                    ? h("button", { style: S.btn(true), disabled: busy === "learn", onClick: function () { learn(row); } }, busy === "learn" ? "…" : "记入词表")
                    : h("button", { style: S.btn(false), onClick: function () { startEdit(row); } }, "改正"),
                  editing ? h("button", { style: S.btn(false), onClick: cancelEdit }, "取消") : null,
                  editing
                    ? null
                    : h("button", { style: S.btnDanger(), disabled: busy === "del", onClick: function () { deleteRow(row); } }, busy === "del" ? "…" : "删除"),
                  row.conf !== undefined
                    ? h("span", { style: { opacity: 0.4, fontSize: "11px" } }, "c" + row.conf)
                    : null
                );
              })
          ),
          note ? h("div", { style: { color: "#2ecc71", fontSize: "12px", marginTop: "6px" } }, "✓ " + note) : null
        ),

        h("div", { style: S.card },
          h("div", { style: S.row },
            h("strong", null, "纠错词表"),
            h("span", { style: { opacity: 0.5, fontSize: "12px" } }, (tbl === null ? "?" : tbl) + " 条（本地，不联网）"),
            h("div", { style: { flex: 1 } }),
            h("button", { style: S.btn(false), onClick: toggleTable }, tblOpen ? "收起" : "管理词表")
          ),
          !tblOpen
            ? h("div", { style: { opacity: 0.5, fontSize: "12px", marginTop: "4px" } },
                "展开可以手动增删词对；点上面听到的话的「改正」也会自动往这里加。")
            : h("div", { style: { marginTop: "8px" } },
                h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
                  h("input", {
                    style: S.input, placeholder: "听错的词，如：插箭", value: addFrom,
                    onChange: function (e) { setAddFrom(e.target.value); },
                    onKeyDown: function (e) { if (e.key === "Enter") addPair(); }
                  }),
                  h("span", { style: { opacity: 0.5 } }, "→"),
                  h("input", {
                    style: S.input, placeholder: "正确的词，如：插件", value: addTo,
                    onChange: function (e) { setAddTo(e.target.value); },
                    onKeyDown: function (e) { if (e.key === "Enter") addPair(); }
                  }),
                  h("button", { style: S.btn(true), disabled: busy === "tbl", onClick: addPair }, busy === "tbl" ? "…" : "添加")
                ),
                tblMsg ? h("div", { style: { color: "#2ecc71", fontSize: "12px", marginTop: "6px" } }, tblMsg) : null,
                h("div", { style: S.list },
                  Object.keys(tblRows).length === 0
                    ? h("div", { style: { opacity: 0.45, padding: "10px 4px" } }, "词表还是空的。")
                    : Object.keys(tblRows).sort().map(function (k) {
                      return h("div", { key: k, style: S.item },
                        h("span", { style: { minWidth: "120px" } }, k),
                        h("span", { style: { opacity: 0.45 } }, "→"),
                        h("span", { style: { flex: 1 } }, tblRows[k]),
                        h("button", { style: S.btn(false), onClick: function () { delPair(k); } }, "删除")
                      );
                    })
                )
              )
        ),

        err ? h("div", { style: S.err }, "⚠ " + err) : null
      );
    }

    // ------------------------------------------------------------------ 发送框旁的纠错开关
    /**
     * 一个小胶囊按钮：开/关语音识别纠错（同音字表 + 免费模型）。
     * 挂在 conversation.input.right（输入框右侧、发送按钮旁边）。
     * 状态读 talk.py 的 127.0.0.1:20129 控制口；监听没开时显示为灰色不可点。
     */
    function CorrectToggle() {
      var _on = useState(null);          // null = 连不上控制口
      var on = _on[0], setOn = _on[1];
      var _busy = useState(false);
      var busy = _busy[0], setBusy = _busy[1];

      var read = useCallback(function () {
        return fetch(CTRL_URL, { method: "GET" })
          .then(function (r) { return r.json(); })
          .then(function (d) { setOn(!!(d && d.correct === true)); })
          .catch(function () { setOn(null); });
      }, []);

      useEffect(function () {
        var alive = true;
        read();
        var timer = setInterval(function () { if (alive) read(); }, 5000);
        return function () { alive = false; clearInterval(timer); };
      }, [read]);

      var flip = useCallback(function () {
        if (busy || on === null) return;
        setBusy(true);
        fetch(CTRL_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !on })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) { setOn(!!(d && d.correct === true)); })
          .catch(function () { setOn(null); })
          .then(function () { setBusy(false); });
      }, [busy, on]);

      var offline = on === null;
      var live = on === true;
      var tip = offline
        ? "语音纠错：连不上监听进程（talk.py 的 20129 口），先开监听"
        : "语音纠错：" + (live ? "开 · 同音字 + 免费模型" : "关 · 只做原样转写");

      return h("button", {
        type: "button",
        onClick: flip,
        disabled: busy,
        title: tip,
        "aria-label": tip,
        "aria-pressed": live,
        style: {
          display: "inline-flex", alignItems: "center", gap: "5px",
          height: "26px", padding: "0 8px", marginRight: "4px",
          borderRadius: "7px", fontSize: "12px", lineHeight: 1,
          cursor: offline ? "default" : "pointer",
          border: "1px solid " + (offline ? "rgba(255,255,255,0.10)"
            : live ? "rgba(47,111,235,0.55)" : "rgba(255,255,255,0.16)"),
          background: live ? "rgba(47,111,235,0.18)" : "transparent",
          color: offline ? "rgba(255,255,255,0.32)" : live ? "#8ab4ff" : "inherit",
          opacity: busy ? 0.6 : 1
        }
      },
        h("span", {
          style: {
            width: "7px", height: "7px", borderRadius: "50%",
            background: offline ? "#777" : live ? "#2ecc71" : "#888",
            boxShadow: live ? "0 0 6px #2ecc71" : "none"
          }
        }),
        h("span", null, "纠错")
      );
    }

    /**
     * 录音状态小灯：挂在发送框旁「纠错」的右边。
     * 说话时红点一闪一闪「录音中」，停下来就是灰点「待机」，不闪。
     */
    function RecIndicator() {
      var _st = useState(null);          // null = 控制口连不上
      var st = _st[0], setSt = _st[1];

      useEffect(function () {
        var alive = true;
        var tick = function () {
          fetch(CTRL_BASE + "/state", { method: "GET" })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (alive) setSt(d || null); })
            .catch(function () { if (alive) setSt(null); });
        };
        tick();
        var tm = setInterval(tick, 400);
        return function () { alive = false; clearInterval(tm); };
      }, []);

      if (!st) return null;
      var speaking = !!st.speaking;
      var phase = st.phase || "";
      var label = speaking ? "录音中"
        : phase === "cooldown" ? "冷却"
          : phase === "transcribing" ? "转写" : "待机";
      var color = speaking ? "#ff4d4f"
        : (phase === "cooldown" || phase === "transcribing") ? "#e6a23c" : "#8a8a8a";

      return h("span", {
        title: speaking ? "正在录音：麦克风在收你的声音" : "现在没在录音",
        style: {
          display: "inline-flex", alignItems: "center", gap: "5px",
          height: "26px", padding: "0 8px", marginRight: "4px",
          borderRadius: "7px", fontSize: "12px", lineHeight: 1,
          border: "1px solid " + (speaking ? "rgba(255,77,79,0.55)" : "rgba(255,255,255,0.12)"),
          background: speaking ? "rgba(255,77,79,0.16)" : "transparent",
          color: speaking ? "#ff8a8a" : "rgba(255,255,255,0.55)"
        }
      },
        h("style", null,
          "@keyframes lilyPulse{0%{opacity:1}50%{opacity:.25}100%{opacity:1}}"),
        h("span", {
          style: {
            width: "7px", height: "7px", borderRadius: "50%", background: color,
            boxShadow: speaking ? "0 0 6px " + color : "none",
            animation: speaking ? "lilyPulse 1s ease-in-out infinite" : "none"
          }
        }),
        h("span", null, label));
    }

    // ------------------------------------------------------------------ 当前会话上报
    /**
     * 把 GUI 当前打开的会话 id 报给宿主；宿主收到语音后就把话注入这个会话，
     * 等于替灿灿在那边发了一条消息。
     */
    function reportActiveSession(ctx) {
      var lastId = "";
      function push() {
        try {
          var svc = null;
          try {
            svc = ctx.get ? ctx.get("uiSession") : null;
          } catch (e) {
            svc = null;
          }
          if (!svc) svc = ctx.uiSession;
          var cur = svc && svc.current;
          var value = cur && cur.value;
          var id = value && value.key;
          if (!id || id === lastId) return;
          lastId = id;
          postJson(API.active, { sessionId: String(id) }).catch(function () {});
        } catch (e) {
          /* 静默：上报失败不影响面板 */
        }
      }
      try {
        ctx.effect(function () {
          push();
          var timer = setInterval(push, 1200);
          return function () { clearInterval(timer); };
        }, "lily-voice: active session reporter");
      } catch (e) {
        /* 静默 */
      }
    }

    // ------------------------------------------------------------------ 注册
    function apply(ctx) {
      var disposers = [];
      try {
        disposers.push(ctx.slots.inject("sidebar.panellist", function () {
          return ctx.slots.register({
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: PANEL_ORDER,
            label: function () { return "莉莉语音"; }
          }, LilyVoiceIcon);
        }));
        disposers.push(ctx.slots.inject("main", function () {
          return ctx.slots.register({
            name: "main",
            key: PANEL_ID,
            inject: function () { return {}; }
          }, LilyVoicePage);
        }));
      } catch (e) {
        console.warn("[lily-voice] panel registration failed:", e);
      }
      // 发送框右侧、发送按钮旁边：语音纠错开关
      try {
        disposers.push(ctx.slots.inject("conversation.input.right", function () {
          return ctx.slots.register({
            name: "conversation.input.right",
            id: PANEL_ID + "-correct",
            order: 5
          }, CorrectToggle);
        }));
        disposers.push(ctx.slots.inject("conversation.input.right", function () {
          return ctx.slots.register({
            name: "conversation.input.right",
            id: PANEL_ID + "-rec",
            order: 6
          }, RecIndicator);
        }));
      } catch (e) {
        console.warn("[lily-voice] composer toggle registration failed:", e);
      }
      reportActiveSession(ctx);
      ctx.effect(function () {
        return function () {
          for (var i = 0; i < disposers.length; i++) disposers[i]();
        };
      }, "lily-voice: ui mounts");
    }

    var inject = ["slots"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
