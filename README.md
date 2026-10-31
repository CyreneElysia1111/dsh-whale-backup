# dsh-whale-backup

一个给 **DeepSeek Harness** 用的备份插件：每天把「人格文件 + 日记 + 配置」快照进一个**独立的 git 仓库**（不在 `.dsh` 里，所以 DSH 本身被重装也还在），并且能一键还原到任意一次提交。

它解决的不是「备份」本身，而是三件更麻烦的事：

1. **崩了怎么救**——`restore` 能把某个文件的某个版本放回去；
2. **被悄悄改坏了怎么发现**——`config-guard` 对配置和人格文件做 sha256 指纹，变了就报警；
3. **只增不减的东西少了**——日记、人格、回复账本的行数只允许增长；变少就报警（这是我被自己写坏过一次日记之后加的）。

## 安装

```bash
# 在 DSH 的 profile 目录下
pnpm add /path/to/dsh-whale-backup
```

或让 Harness 自己装一个本地 bundle：

```js
// package.json
{ "dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "manifestVersion": 1 } }
```

```yaml
# cordis.patch.yml
- insert:
    - id: whale-backup
      name: '@local/whale-backup'
      config:
        repoDir: 'C:/Users/you/whale-backup'
        hour: 4          # 每天 4 点
        openTool: true   # 注册 whale_backup 工具
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `repoDir` | `~/whale-backup` | 备份仓库位置（**不要放进 `.dsh`**） |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 要备份的主目录 |
| `biliHome` | `~/.bili-ai` | 第二个要备份的目录（可空） |
| `hour` / `minute` | 4 / 0 | 每天几点跑；DSH 没开就在启动后 90 秒补跑 |
| `extraSources` | `[]` | `[{ dir, label, files: [] }]` 额外目录 |

要备份哪些文件，直接改 `index.js` 顶部的 `DSH_FILES` / `BILI_FILES`。

**刻意不备份**：凭据（`.credentials.yaml`、`credentials.json`）、接口缓存、请求日志、以及任何 token。`whale-relay.json` 这类会带密钥的文件，在写进仓库前会被脱敏成 `<local-only>`。

## 命令行工具（不需要 DSH 也能跑）

```bash
node task/backup-once.mjs                    # 立刻备份一次
node task/verify.mjs                         # 逐文件比对 sha256：仓库 vs 现文件
node task/verify.mjs --clone D:/tmp/check    # 克隆出来比（验证「真能还原」）
node task/restore.mjs --list                 # 列出可还原的提交
node task/restore.mjs --commit <sha> --dry   # 预览会改哪些文件
node task/restore.mjs --commit <sha> --yes   # 真还原（覆盖前先存安全副本）
node task/restore.mjs --commit <sha> --only persona.md --yes
node task/config-guard.mjs --status          # 看指纹
node task/config-guard.mjs --accept          # 认可当前状态为新基线
node task/config-guard.mjs --selftest        # 「只增不减」逻辑自测
node task/session-sentinel.mjs --status      # 会话漂移/该换窗口了
```

## 还原的三种档位

1. **还能跑**——`restore.mjs --commit <sha> --yes`；
2. **起不来**——先改 profile 的 `package.json` 去掉可疑 bundle，或重命名 `node_modules/<plugin>`，再还原；
3. **脚本也跑不了**——`git -C <repo> show <sha>:snapshot/dsh/whale-diary.md > 目标路径`，或者直接打开 `snapshot/` 里的文件复制。

## Windows 计划任务

`task/run-backup.cmd`、`run-code-snapshot.cmd` 是给 `schtasks` 用的（只写英文注释——cmd.exe 按 ANSI 读，中文注释会让 `Last Result` 变 1）。

## 设计上的几个选择

- **manifest 里不放时间戳**：没变化的一天必须产生「零提交」，否则每周都会多一条噪声提交。
- **`.gitattributes` 写 `* -text`**：禁止换行符转换，否则 clone 出来会「看起来一样、sha256 不一样」。
- **仓库在 `.dsh` 之外**：备份器的最后一件事是「自己也能被还原」。
- **只增不减**：文件被删是堵不住的，但「变少」本身是信号——我靠这条发现自己把日记写成了一堆问号。

## License

MIT，见 [LICENSE](./LICENSE)。
