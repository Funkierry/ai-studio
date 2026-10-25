# AI 工作室

多个 AI 员工在一间像素办公室里协作干活的本地系统。你是老板：发订单、安排分工、拍板、验收。
公司需要记录的东西都是真的：Git 代码库、文档库、数据库和各类事务记录。

## 运行

需要 Node.js 22.13 以上（自带 SQLite）和 Git。

```bash
npm install
cp .env.example .env   # 填 ANTHROPIC_API_KEY / OPENAI_API_KEY
node server.js
```

打开 http://localhost:5300 是办公室，http://localhost:5300/company.html 是公司系统。

可选参数：`--port 5300`、`--data <目录>`（默认是项目里的 `data/`）、`--fake-llm`（用测试替身代替真实模型，不花钱，只用来测流程）。

## 谁用什么模型

| 员工 | 模型 | 配置 |
|---|---|---|
| 克劳德 | Claude（默认 `claude-opus-5-5`） | `ANTHROPIC_API_KEY`，或先运行 `ant auth login`；`STUDIO_CLAUDE_MODEL` 可改模型 |
| 阿 G、小码 | GPT（默认 `gpt-5`） | `OPENAI_API_KEY`；`STUDIO_OPENAI_MODEL` 改模型，`STUDIO_OPENAI_PRICE=输入,输出`（美元/百万 token）用于记账 |
| DeepSeek 员工 | DeepSeek（默认 `deepseek-flash`） | `DEEPSEEK_API_KEY`；`STUDIO_DEEPSEEK_MODEL=deepseek-v4-pro` 可换大模型；记账按高峰价估算（闲时是一半） |
| Gemini 员工 | 还没接入 | 交付物用模板 |

同一种 AI 可以招多名员工（招聘窗口里每种都能反复录用，可以自己起名）。他们共用这一种的模型，但各自有名字、长期偏好、经验等级和默契度。

项目里每份分工做完时，员工会把这些材料交给自己的模型：项目目标、工作单、自己的分工和下游是谁、老板对自己的长期偏好、本项目里老板做过的决定、工作中老板说过的话、修改意见和上一版、上游同事的文档和代码、代码库现状。
模型按固定的 JSON 结构交回文档或代码文件；没有密钥、接口出错、被拒绝、输出不合法时，自动退回模板，并在日志和文档里写明原因。
每份分工实际用的提示词保存在 `data/briefs/<项目>/`，真实调用的 token 和花费记在账本里（公司系统 → 事务记录 → 模型调用）。

设了「做完先给我确认」的分工，员工会带着真正写好的交付物到老板门口：可以打开文档、看代码，再决定通过或写一句修改意见发回重写。

## 公司系统里有什么

| 系统 | 存在哪 | 内容 |
|---|---|---|
| 代码库 | `data/repos/<项目>/`，每个项目一个 Git 仓库 | 每个开发分工一个分支、一次提交、一个合并请求，由下游同事审查；测试分工先合并大家的代码再跑自动化测试；验收后合并并打 `v1.0` 标签 |
| 文档库 | `data/docs/`，一个 Git 仓库 | 工作单、各分工的交付文档、会议纪要、单独订单的交付物、项目总结；网页上可编辑，每次保存都是一个新版本 |
| 业务数据库 | `data/biz/<项目>.db` | 后端分工建的数据表和示例数据 |
| 事务记录 | `data/company.db` | 任务工单、项目与分工、审批与决策、交付验收、打回记录、会议、合并请求、花费账本、员工档案（等级、偏好、默契度）、动态日志 |

所有这些都可以直接用普通工具打开：`git log`、任何 SQLite 客户端、任何 Markdown 编辑器。

## 现在还是模板的部分

- 办公室里员工之间的对话和过程是预设脚本，用来展示协作；真正的交付物由模型写。
- 单独订单（不是「安排工作」立项的）交付的文档还是模板。
- 阿深（DeepSeek）、双子（Gemini）还没接入模型。

## 目录

- `server.js`：本地服务和接口
- `lib/company.js`：公司系统的业务逻辑（立项、分工交付、合并、验收、记录）
- `lib/writer.js`：让员工的模型写交付物（提示词约定、输出结构、校验、退回模板）
- `lib/providers/`：Claude（Anthropic SDK）和 GPT（OpenAI SDK）的调用
- `lib/produce.js`：交付文档的排版，以及模型不可用时的模板
- `lib/git.js`、`lib/store.js`：Git 和数据库
- `public/index.html`：办公室；`public/company.html`：公司系统
