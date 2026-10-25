// 合成整学期样本：验证多周合并、跨大节课程、缺节次补齐与校本部作息判定。
// 不包含真实账号；数字与课程名仅用于覆盖解析分支。
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const SCRIPT = path.join(__dirname,
  '..', '..', 'app', 'src', 'main', 'assets',
  'shiguang_warehouse-main', 'resources', 'SMU', 'smu.js');

// 适配器元数据与脚本里的 URL 必须是干净的单层协议。
// normalizeEduUrl 只判断是否以 https:// 开头，写错成 https://https://host 会被
// 原样交给 WebView，主机名变成 "https"，页面根本打不开。
const ADAPTER_YAML = path.join(__dirname,
  '..', '..', 'app', 'src', 'main', 'assets',
  'shiguang_warehouse-main', 'resources', 'SMU', 'adapters.yaml');

function assertCleanUrls() {
  const yamlText = fs.readFileSync(ADAPTER_YAML, 'utf8');
  const importUrl = (yamlText.match(/^\s*import_url:\s*"([^"]*)"/m) || [])[1];
  assert.ok(importUrl, 'adapters.yaml 缺少 import_url');
  assert.equal(
    (importUrl.match(/https?:\/\//g) || []).length, 1,
    `import_url 出现多层协议：${importUrl}`
  );
  assert.ok(importUrl.startsWith('https://'), `import_url 必须是 https：${importUrl}`);
  assert.equal(importUrl, 'https://zhjw.smu.edu.cn/', 'import_url 应为教务站点根地址');

  const scriptText = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(
    !/https?:\/\/https?:\/\//.test(scriptText),
    'smu.js 注释或代码里出现多层协议'
  );
}

assertCleanUrls();

function row(overrides) {
  return Object.assign({
    flfzmc: '', ps: '01', pe: '02', bapjxcd: '0', qssj: '08:00:00', jssj: '09:25:00',
    kcmc: '课程', teaxms: '教师', jxcdmc: '教学楼', zc: 1, xq: 1, qsxq: '2',
    qsrq: '2026-08-31', xnxqdm: '202601', xs: 2
  }, overrides);
}

// 校本部作息：第1节 08:00，跨大节到第6节 14:30。
const rows = [
  // 同一课程 3 周，应合并成 weeks=[1,2,3]
  row({ zc: 1, qsrq: '2026-08-31', qssj: '08:00:00', jssj: '09:25:00' }),
  row({ zc: 2, qsrq: '2026-09-07' }),
  row({ zc: 3, qsrq: '2026-09-14' }),
  // 周二 第3-5节 校本部 09:50 起（大节内 45 分钟递推）
  row({ zc: 1, xq: 2, qsxq: '3', qsrq: '2026-09-01', ps: '03', pe: '05', qssj: '09:50:00', jssj: '12:00:00', kcmc: '大节课程' }),
  // 周四 第1-8节 跨大节长块，校本部 08:00 起
  row({ zc: 1, xq: 4, qsxq: '5', qsrq: '2026-09-03', ps: '01', pe: '08', qssj: '08:00:00', jssj: '17:40:00', kcmc: '跨大节课程' }),
  // 晚上 第10-11节
  row({ zc: 1, xq: 5, qsxq: '6', qsrq: '2026-09-04', ps: '10', pe: '11', qssj: '19:30:00', jssj: '20:55:00', kcmc: '晚课' }),
  // 不用场地标记
  row({ zc: 1, xq: 6, qsxq: '7', qsrq: '2026-09-05', ps: '06', pe: '07', qssj: '14:30:00', jssj: '15:55:00', kcmc: '自主学习课', bapjxcd: '1', jxcdmc: '' })
];

const semesterOptions = [
  { value: '202601', selected: true, textContent: '2026-2027-1' }
];
const fakeDoc = {
  querySelector: (s) => {
    if (s === '#xnxqdm') return { options: semesterOptions };
    // 周次下拉框：门户给出完整学期周数（含无课周），这里模拟到第 18 周。
    if (s === '#zc') {
      const options = [{ value: '' }];
      for (let week = 1; week <= 18; week++) options.push({ value: String(week) });
      return { options };
    }
    return null;
  },
  querySelectorAll: () => [],
  body: {}
};

const messages = [];
const bridgeCalls = [];
const fetchRequests = [];
// 模拟真实接口：zc 为空返回「全部」行（zc 字段为 0，语义不确定）；
// zc 指定具体周次时，返回该周的记录，qsrq 是该周真实的某一天。
// 第 1 周周一 = 2026-08-31，所以第 N 周星期 D 的日期 = 08-31 + (N-1)*7 + (D-1)。
function dateForWeekDay(week, weekday) {
  const base = new Date(2026, 7, 31);
  base.setDate(base.getDate() + (week - 1) * 7 + (weekday - 1));
  const p = (n) => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
}
const win = {
  console,
  document: fakeDoc,
  location: { href: 'https://smu.example/new/student/xsgrkb/week.page' },
  AbortController,
  setTimeout: () => 0,
  clearTimeout: () => {},
  alert: () => {},
  fetch: async (url, options) => {
    const body = String((options && options.body) || '');
    const zcMatch = body.match(/(?:^|&)zc=([^&]*)/);
    const zc = zcMatch ? decodeURIComponent(zcMatch[1]) : '';
    fetchRequests.push({ url, zc, body });
    let payload;
    if (zc === '') {
      // 「全部」模式：真实接口返回整学期记录，zc 是多周合并值（如 "1,2,3"）。
      // 这里把三次同课按 zc 合并成 "1,2,3"，qsrq 保留该行最早那次。
      const byKey = new Map();
      for (const r of rows) {
        const key = `${r.kcmc}|${r.xq}|${r.ps}|${r.pe}`;
        if (!byKey.has(key)) {
          byKey.set(key, { ...r, zc: String(r.zc) });
        } else {
          const kept = byKey.get(key);
          kept.zc = `${kept.zc},${r.zc}`;
        }
      }
      payload = [...byKey.values()];
    } else {
      const week = Number(zc);
      // 指定周次时只返回该周有课的记录，qsrq 为该周真实日期。
      payload = rows
        .filter((r) => r.zc === week || r.zc === 1)
        .map((r) => ({ ...r, zc: week, qsrq: dateForWeekDay(week, r.xq) }));
      if (week !== 1) payload = rows.slice(0, 2).map((r) => ({ ...r, zc: week, qsrq: dateForWeekDay(week, r.xq) }));
    }
    return {
      ok: true, status: 200,
      clone: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
      text: async () => JSON.stringify({ code: 0, data: payload, message: '成功' })
    };
  }
};
win.shiguangBridge = {
  isAvailable: () => true,
  showToast: (m) => messages.push({ action: 'showToast', message: m }),
  notifyTaskCompletion: () => bridgeCalls.push('notifyTaskCompletion'),
  notifyExecutionFinished: () => {}
};
win.shiguangBridgePromise = {
  showAlert: async (t, c) => { messages.push({ action: 'showAlert', titleText: t, contentText: c }); return true; },
  showSingleSelection: async () => 0,
  saveImportedCourses: async (j) => { bridgeCalls.push({ action: 'courses', payload: JSON.parse(j) }); return true; },
  saveCourseConfig: async (j) => { bridgeCalls.push({ action: 'config', payload: JSON.parse(j) }); return true; },
  savePresetTimeSlots: async (j) => { bridgeCalls.push({ action: 'slots', payload: JSON.parse(j) }); return true; }
};
win.window = win;
vm.createContext(win);

(async () => {
  vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), win);
  for (let i = 0; i < 200; i++) await Promise.resolve();

  const failed = messages.find((m) => m.action === 'showAlert' && /失败|未解析/.test(m.titleText));
  assert.equal(failed, undefined, '导入不应失败');

  const courses = bridgeCalls.find((c) => c.action === 'courses').payload;
  const config = bridgeCalls.find((c) => c.action === 'config').payload;
  const slots = bridgeCalls.find((c) => c.action === 'slots').payload;

  // 多周合并
  const merged = courses.find((c) => c.name === '课程');
  assert.deepEqual(merged.weeks, [1, 2, 3], '同课程 3 周应合并为 weeks=[1,2,3]');

  // 开学日期：2026-08-31 是周一
  assert.equal(config.semesterStartDate, '2026-08-31', '开学日期必须推算出来');
  // 关键回归：不能只在「全部」结果上推算（其 zc 可能为 0，语义不确定）。
  // 必须真的发起过带具体周次的探测请求。
  const probeRequests = fetchRequests.filter((r) => r.zc !== '');
  assert.ok(probeRequests.length > 0, '必须按具体周次探测开学日期，而不是只用全部结果');
  assert.ok(
    fetchRequests.some((r) => r.zc === ''),
    '仍应有一次全部周次的请求用于取全部课程'
  );
  // 总周数取门户周次下拉框（18 周，含无课周），而非已排课的最大周（3）
  assert.equal(config.semesterTotalWeeks, 18, '学期总周数应取周次下拉框的完整周数');
  assert.equal(config.defaultClassDuration, 40);
  assert.equal(config.defaultBreakDuration, 5);

  // 校本部作息判定：第1节 08:00、第3节 09:50、第6节 14:30、第10节 19:30
  const byNumber = Object.fromEntries(slots.map((s) => [s.number, s.startTime]));
  assert.equal(byNumber[1], '08:00', '校本部第1节');
  assert.equal(byNumber[2], '08:45', '同大节递推');
  assert.equal(byNumber[3], '09:50', '校本部第3节');
  assert.equal(byNumber[4], '10:35', '第3-5节块内递推');
  assert.equal(byNumber[5], '11:20', '第3-5节块内递推');
  assert.equal(byNumber[6], '14:30', '校本部第6节（跨大节不得线性递推）');
  assert.equal(byNumber[7], '15:15', '第6-7节块内递推');
  assert.equal(byNumber[8], '16:15', '跨大节块只采信起始节，需用对照表补齐');
  assert.equal(byNumber[10], '19:30', '晚课');
  assert.equal(byNumber[11], '20:15', '第10-11节块内递推');

  // 节次时间不得重叠
  for (let i = 1; i < slots.length; i++) {
    assert.ok(slots[i].startTime >= slots[i - 1].endTime,
      `第${slots[i].number}节开始 ${slots[i].startTime} 早于第${slots[i - 1].number}节结束 ${slots[i - 1].endTime}`);
  }

  // 不用场地的处理
  assert.equal(courses.find((c) => c.name === '自主学习课').position, '不用场地');
  // 跨大节课程保留完整节次范围
  const spanning = courses.find((c) => c.name === '跨大节课程');
  assert.equal(spanning.startSection, 1);
  assert.equal(spanning.endSection, 8);

  console.log('PASS: import_url 单层协议、多周合并、跨大节不递推、校本部作息、节次不重叠、不用场地');
  console.log('作息:', slots.map((s) => `${s.number}:${s.startTime}`).join(' '));
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
