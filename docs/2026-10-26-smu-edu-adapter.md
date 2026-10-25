# 南方医科大学教务适配（拾光 adapter）落地记录

日期：2026-10-26，Asia/Shanghai。

## 任务

为 `https://zhjw.smu.edu.cn`（南方医科大学，广州乘方科技「智慧教务」）新增拾光教务适配器，使其在 SleepDown 的「教务导入」中可选并正确导入个人课表。

## 结论

上游 `shiguang_warehouse` 没有该校适配器（`root_index.yaml` 与 `resources/` 均无 `SMU`），本次按上游约定的目录与索引格式新增，并重新编译 `school_index.pb`。

## 教务系统事实（真实页面与接口取证）

- 入口：`信息查询 → 课表查询 → 我的课表`，页面为 `GET /new/student/xsgrkb/week.page?xnxqdm=<学期码>`，学期码形如 `202601`。
- 课表数据接口：`POST /new/student/xsgrkb/getCalendarWeekDatas`，表单参数 `xnxqdm`、`zc`、`d1`、`d2`。
  - `zc` 为空表示「全部周次」，返回整学期记录；返回的每条记录自带 `zc`、`xq`、`ps`、`pe`、`qsrq` 等字段。
  - 页面自身也用该接口渲染 fullCalendar，因此脚本复用同一接口，不解析 DOM。
- 关键字段：`kcmc` 课程名、`teaxms` 教师、`jxcdmc` 教学场地、`ps`/`pe` 起止节次、`zc` 周次、`xq` 星期（周一=1）、`qssj`/`jssj` 起止时间、`qsrq` 上课日期、`bapjxcd="1"` 表示不用场地。
- `zc` 是逗号分隔的周次列表，页面用 `getWeekSummary(zc)` 折叠成 `7,15,17` 这样的区间串（见 `styles/ntsscalendar/lib/dckj_calendar.js`）。
- 节次上限为 14（`styles/js/ntss.js` 的 `kbJcArr`）。
- 学校分「校本部」与「顺德校区」两套作息，逐 5 分钟错开。官方「课表时间对照表」公布了两套各节次时间（门户首页可查）。同一大节内相邻小节相差 45 分钟（40 上课 + 5 课间），但跨大节另有更长课间，**不能用固定步长跨大节递推**。

## 实现要点（`resources/SMU/smu.js`）

- 一次拉取整学期：`zc` 留空，日期范围覆盖整个学年。
- 开学日期：由每条记录的 `qsrq - (周次-1)*7 - (星期-1)` 反推第 1 周周一并取众数，无需用户手填。
- 校区判定：按各节次起始时间在两个校区时间表上投票；打平按顺德校区（两校区第 10 节以后完全一致，在校生主体在顺德）。
- 节次时间：用接口返回的真实 `qssj` 在**同一大节组内**按 45 分钟递推投票，未被覆盖的节次回落到学校公布的时间对照表。
- 学期总周数：优先取课表页「周次」下拉框的完整周数（含无课周），与已排课周次最大值取较大者。
- 课程合并：按 `课程名|教师|场地|星期|起止节次` 合并，周次取并集。
- 交互：多学期时让用户选择；导入前弹确认框列出学期、作息、开学日期、课程数与覆盖周次，确认后才写入。

## 验证

本机没有 JDK 与 Miuix 本地源码，`compileGithubReleaseKotlin` 无法执行；本次不改 Kotlin，只新增 assets 资源与测试脚本。

实际执行：

- `node scripts/tests/smu-adapter-parsing.cjs` 通过：多周合并、跨大节不按固定步长递推、校本部作息识别、节次时间不重叠、`bapjxcd=1` 转「不用场地」、学期总周数取周次下拉框。
- 真实第 3 周响应解析：18 个课程时间段、顺德校区 13 节作息、开学日期 `2026-08-31`；第 3 周周一 = `2026-09-14`，与门户显示的「第 9 周 = 10/26」一致。
- 节次时间与官方对照表逐项一致（顺德：08:30/09:15/10:20/11:05/11:50/14:00/14:45/15:45/16:30/19:30…）。
- `python scripts/check_architecture.py`：437 个 Kotlin 文件，边界通过。
- `school_index.pb` 重新编译后与旧索引逐条比对：仅新增 `SMU / SMU_01`，其余 160 个适配器字段无任何变化，学校数 149 → 150。

未执行：Gradle 编译与实机安装（环境缺 JDK）。

## 文件

- 新增 `app/src/main/assets/shiguang_warehouse-main/resources/SMU/adapters.yaml`
- 新增 `app/src/main/assets/shiguang_warehouse-main/resources/SMU/smu.js`
- 修改 `app/src/main/assets/shiguang_warehouse-main/index/root_index.yaml`（登记 SMU）
- 修改 `app/src/main/assets/shiguang_warehouse-main/school_index.pb`（按 YAML 重新编译）
- 修改 `SLEEPDOWN_UPSTREAM.txt`（注明 SMU 为本地新增，上游同步时保留）
- 新增 `scripts/tests/smu-adapter-parsing.cjs`

## 测试版构建（2026-10-26）

产出了可安装的 debug 测试包，用于真机验证适配器，不改正式发布链路。

构建环境（本机原本三项都缺，已补齐）：

- JDK 17（Temurin `17.0.20.1+1`，清华镜像）+ JDK 21（Temurin `21.0.12.1+1`）：Miuix 的 `module.kotlin-jvm-toolchain` 要求 `JDK_VERSION = 21`，主工程用 17，两个都要注册到 `org.gradle.java.installations.paths`。
- `miuix-reference`：`v0.9.3` 克隆后 `git apply patches/miuix-0.9.3-sleepdown.patch`（20 文件，+1510/−288）。
- Android SDK `platforms;android-37.1`（仓库只带 android-36，而 `compileSdk = release(37)`）。
- `dl.google.com` 在本机不可达，Miuix 的 `settings.gradle.kts` 仓库加阿里云镜像后才能解析 Compose 依赖。

测试包走项目自带的本地适配器机制 `-Psleepdown.eduAdapterTestAssets=<dir>`，而不是往内置索引里塞 SMU：`ShiguangWarehouse.loadAdapters` 在 `BuildConfig.SLEEPDOWN_LOCAL_EDU_TEST` 为真时从 `edu_adapter_test/` 读取独立索引并标注「（本地测试）」，与远端索引隔离，不会被后续远端索引刷新覆盖。

构建命令：

```powershell
$env:JAVA_HOME='D:\Sleepdown\jdk\jdk-17.0.20.1+1'
$env:GRADLE_USER_HOME='C:\Users\Xi\.gradle'
$env:ANDROID_HOME='D:\Sleepdown\android-sdk'
.\gradlew.bat -Psleepdown.miuixSourcePath=D:/Sleepdown/miuix-reference `
  -Psleepdown.eduAdapterTestAssets=D:/Sleepdown/SleepDown-Schedule/app/src/main/assets/edu_adapter_test `
  -Dorg.gradle.java.installations.paths='D:/Sleepdown/jdk/jdk-17.0.20.1+1,D:/Sleepdown/jdk21/jdk-21.0.12.1+1' `
  assembleGithubDebug --console=plain --no-daemon --no-parallel --max-workers=2
```

产物核验：`versionName = 1.2.7.1-edu-test`、`applicationId = com.xiaomanjun.sleepdownschedule.debug`（可与正式版并存）、`SLEEPDOWN_LOCAL_EDU_TEST = true`、`apksigner verify` 通过（Android Debug 证书）、APK 内 `assets/edu_adapter_test/` 含 SMU 索引与脚本。

路径参数必须用正斜杠：`-P` 与 `local.properties` 里的反斜杠在 MSYS bash 下会被吞掉，报「文件名或目录语法不正确」。

未执行：实机安装（当时没有连接设备）。

## 上游 PR（2026-10-26）

已向上游提交：[ShiGuangSchedule/shiguang_warehouse#895](https://github.com/ShiGuangSchedule/shiguang_warehouse/pull/895)

- 仓库：`xingheyuzhuan/shiguang_warehouse` 已永久重定向为 **`ShiGuangSchedule/shiguang_warehouse`**，PR 应指向后者。
- Fork：`nekojackie/shiguang_warehouse`，分支 `add-smu-adapter`，目标分支 `pending`（上游 README 明确要求，`main` 有分支保护）。
- 内容：仅 `resources/SMU/adapters.yaml`、`resources/SMU/smu.js`、`index/root_index.yaml` 三个文件（+563/−1）。未提交 `school_index.pb`（由上游 CI 编译）、测试脚本和文档。
- `maintainer` 填 `nekojackie`；提交作者也用该身份。本机 `SleepDown-Schedule` 仓库的 git 配置是 `xiaomanjun233`，直接提交会把作者写错，需要显式指定或 `--reset-author`。
- 推送 `--force-with-lease` 在本机 git 下报 `stale info`，需显式写期望 SHA：`--force-with-lease=branch:<sha>`。

**重要**：SleepDown 实际从 Gitee 拉索引（`ShiguangWarehouseUpdater.kt` 的 `IndexUrl` 指向 `gitee.com/XingHeYuZhuan-gh/shiguang_warehouse`）。所以即使 GitHub PR 合并，也要等上游把改动同步到 Gitee 并重编 `index-pb-release`，手机端才会真正生效；在那之前，拉到的远端索引会覆盖内置的 SMU，SMU 会从列表里消失。内置资源只在没有有效远端索引时作为兜底。

## 后续

- 等上游审核 #895；合并后跟踪 Gitee 侧索引是否同步。
- 若需要让已安装的 App 立刻可用，保留内置 `resources/SMU/` 作为兜底，不要依赖远端索引。
