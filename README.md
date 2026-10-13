# 贪吃蛇 Snake Game

基于 Python + pygame-ce 实现的经典贪吃蛇小游戏，单文件结构，使用 git 进行版本管理。

## 玩法

| 操作 | 按键 |
|---|---|
| 移动 | 方向键 或 `W` `A` `S` `D` |
| 暂停 / 继续 | `空格` |
| 重新开始 | `R` 或 `回车`（结束后） |
| 退出 | `Esc` |

- 吃到红色食物 +10 分，蛇身变长
- 每吃 4 个食物速度提升一档，最高 26 格/秒
- 撞墙或撞到自己即游戏结束
- 最高分自动保存在 `snake_highscore.json`

## 运行

```bash
pip install -r requirements.txt
python snake_game.py
```

## git 工作流

```bash
git status                  # 查看改动
git add -A                  # 暂存所有改动
git commit -m "改动说明"     # 提交
git log --oneline           # 查看历史
git diff                    # 查看未暂存的改动
```

改坏了想回退到上一个提交：

```bash
git checkout -- snake_game.py        # 丢弃单个文件的工作区改动
git reset --hard HEAD                # 丢弃所有未提交改动（慎用）
```

## 项目结构

```
snake_game.py          # 游戏主程序（单文件）
requirements.txt       # 依赖清单
.gitignore             # git 忽略规则
README.md              # 本文件
```

## 代码结构

`snake_game.py` 主要分为几个部分，方便阅读和二次开发：

- **常量配置区** — 格子尺寸、棋盘大小、速度参数、配色方案
- **`Snake` 类** — 蛇的实体，用 `deque` 存身体，含方向控制、碰撞检测
- **`Food` 类** — 食物生成，会在空白格中随机落点
- **`Game` 类** — 游戏主体，管理状态机（准备/进行/暂停/结束）、输入、更新、渲染
- **主循环** — 固定 60 帧渲染，逻辑按速度参数分步推进

想调节难度，改这几个常量即可：

```python
BASE_FPS = 8        # 初始速度
MAX_FPS = 26        # 速度上限
SPEED_UP_EVERY = 4  # 每吃几个食物提速
STEP_FPS = 2        # 每次提速多少
GRID_W, GRID_H = 20, 20   # 棋盘大小
```

## 实现要点

- **方向输入队列**：按键存入 `dir_queue`，避免一帧内连按两次导致反向自杀
- **撞自己判定**：尾部那一节在这一帧会移走，所以判定时排除它（`pending_growth == 0` 时）
- **最高分持久化**：存在脚本同目录的 `snake_highscore.json`，只读环境下静默失败不影响游戏
- **无头测试**：设置 `SDL_VIDEODRIVER=dummy` 可在无显示器环境下跑逻辑测试

## 可选：打包成 exe

如果之后又想分发给别人玩（暂时不需要）：

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name SnakeGame snake_game.py
```

产物在 `dist/SnakeGame.exe`。注意 `dist/` 和 `build/` 已在 `.gitignore` 中排除，不会污染仓库。
