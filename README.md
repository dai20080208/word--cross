# 贪吃蛇 Snake Game

基于 Python + pygame-ce 实现的经典贪吃蛇小游戏，可打包成单个 `.exe` 文件分享给朋友，双击即玩。

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

## 运行（需要 Python）

```bash
pip install pygame-ce
python snake_game.py
```

## 打包成 exe（分享给朋友）

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name SnakeGame snake_game.py
```

打包完成后，`dist/SnakeGame.exe` 就是最终成品。把这个文件发给朋友，双击即可运行，**对方不需要安装 Python 或任何依赖**。

> 注意：`--windowed` 表示不显示黑色控制台窗口。如果你想在出错时看到日志，去掉这个参数即可。

## 跨平台说明

- 在 **Windows** 上打包 → 得到 `.exe`，只能给 Windows 用户用
- 在 **macOS** 上打包 → 得到可执行文件，只能给 macOS 用户用
- 想让 Mac 朋友也玩，需要在 Mac 上重新打包一次

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
