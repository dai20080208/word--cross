# -*- coding: utf-8 -*-
"""
贪吃蛇 Snake Game
-----------------
基于 pygame-ce 实现的经典贪吃蛇，支持：
  - 方向键 / WASD 控制
  - 逐渐加速（吃到食物速度变快）
  - 分数、最高分（本地持久化）
  - 暂停 / 重新开始
  - 网格绘制、蛇身渐变色、圆角食物

运行: python snake_game.py
打包: pyinstaller --onefile --windowed --name SnakeGame snake_game.py
"""

import os
import sys
import json
import random
from collections import deque

import pygame

# ---------------------------------------------------------------------------
# 常量配置
# ---------------------------------------------------------------------------
CELL = 28                      # 单个格子像素大小
GRID_W, GRID_H = 20, 20        # 棋盘 20x20 格
INFO_H = 64                    # 顶部信息栏高度

WIN_W = CELL * GRID_W          # 窗口宽
WIN_H = CELL * GRID_H + INFO_H # 窗口高

BASE_FPS = 8                   # 初始速度（每秒移动格数）
MAX_FPS = 26                   # 速度上限
SPEED_UP_EVERY = 4             # 每吃 N 个食物提速 1 级
STEP_FPS = 2                   # 每个食物提升的速度

# 配色（浅色系，清爽）
C_BG        = (247, 249, 252)
C_GRID      = (232, 237, 245)
C_INFO_BG   = (255, 255, 255)
C_INFO_LINE = (222, 229, 240)
C_TEXT      = (38, 48, 66)
C_TEXT_DIM  = (139, 150, 170)
C_SNAKE_HEAD= (37, 160, 108)
C_SNAKE_BODY= (72, 199, 142)
C_SNAKE_TAIL= (150, 224, 190)
C_FOOD      = (241, 92, 88)
C_FOOD_EDGE = (208, 62, 60)
C_ACCENT    = (66, 133, 244)

# 最高分文件（放在 exe / 脚本同目录）
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCORE_FILE = os.path.join(BASE_DIR, "snake_highscore.json")

# 方向向量
UP, DOWN, LEFT, RIGHT = (0, -1), (0, 1), (-1, 0), (1, 0)


def load_high_score() -> int:
    try:
        with open(SCORE_FILE, "r", encoding="utf-8") as f:
            return int(json.load(f).get("high_score", 0))
    except (OSError, ValueError, KeyError):
        return 0


def save_high_score(score: int) -> None:
    try:
        with open(SCORE_FILE, "w", encoding="utf-8") as f:
            json.dump({"high_score": score}, f, ensure_ascii=False)
    except OSError:
        pass  # 只读环境（如某些受保护目录）下静默失败，不影响游戏


def lerp_color(c1, c2, t: float):
    """在两个颜色之间线性插值，t 取 0~1。"""
    t = max(0.0, min(1.0, t))
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


# ---------------------------------------------------------------------------
# 蛇
# ---------------------------------------------------------------------------
class Snake:
    """蛇的实体：身体用 deque 保存，队首是头。"""

    def __init__(self, start_x: int, start_y: int, length: int = 3):
        cx, cy = start_x, start_y
        # 水平放置，头在最前面
        self.body = deque((cx - i, cy) for i in range(length))
        self.direction = RIGHT
        self.pending_growth = 0

    @property
    def head(self):
        return self.body[0]

    def set_direction(self, new_dir) -> bool:
        """设置方向，禁止 180 度掉头。返回是否生效。"""
        dx, dy = new_dir
        hx, hy = self.direction
        if (dx, dy) == (-hx, -hy):
            return False
        self.direction = new_dir
        return True

    def next_head(self):
        hx, hy = self.head
        dx, dy = self.direction
        return (hx + dx, hy + dy)

    def move(self, grow: bool = False) -> None:
        """向当前方向前进一格。grow=True 时不删尾（变长）。"""
        self.body.appendleft(self.next_head())
        if not grow:
            self.body.pop()

    def grow(self, n: int = 1) -> None:
        self.pending_growth += n

    def hits_wall(self) -> bool:
        x, y = self.next_head()
        return not (0 <= x < GRID_W and 0 <= y < GRID_H)

    def hits_self(self) -> bool:
        """撞到自己。注意：尾巴这一帧会移走，所以不含最后一节。"""
        nxt = self.next_head()
        occupied = list(self.body)
        if self.pending_growth == 0:
            occupied = occupied[:-1]  # 尾巴即将离开
        return nxt in occupied

    def cells(self):
        return list(self.body)


# ---------------------------------------------------------------------------
# 食物
# ---------------------------------------------------------------------------
class Food:
    def __init__(self):
        self.pos = (0, 0)

    def respawn(self, snake_cells) -> None:
        """在空白格中随机放一个食物。"""
        occupied = set(snake_cells)
        free = [
            (x, y)
            for x in range(GRID_W)
            for y in range(GRID_H)
            if (x, y) not in occupied
        ]
        self.pos = random.choice(free) if free else (-1, -1)


# ---------------------------------------------------------------------------
# 游戏主体
# ---------------------------------------------------------------------------
STATE_READY = "ready"
STATE_PLAYING = "playing"
STATE_PAUSED = "paused"
STATE_OVER = "over"


class Game:
    def __init__(self):
        pygame.init()
        self.screen = pygame.display.set_mode((WIN_W, WIN_H))
        pygame.display.set_caption("贪吃蛇 · Snake")
        self.clock = pygame.time.Clock()
        self.font_big = self._font(38, bold=True)
        self.font_mid = self._font(22, bold=True)
        self.font_small = self._font(16)
        self.high_score = load_high_score()
        self.reset()

    # -- 字体：优先中文字体，找不到退到默认 ------------------------------
    @staticmethod
    def _font(size: int, bold: bool = False):
        for name in ("Microsoft YaHei", "SimHei", "PingFang SC", "Arial Unicode MS"):
            try:
                f = pygame.font.SysFont(name, size, bold=bold)
                if f:
                    return f
            except Exception:
                continue
        return pygame.font.Font(None, size)

    # -- 重开 -------------------------------------------------------------
    def reset(self) -> None:
        cx, cy = GRID_W // 2, GRID_H // 2
        self.snake = Snake(cx, cy, length=3)
        self.food = Food()
        self.food.respawn(self.snake.cells())
        self.score = 0
        self.eaten = 0
        self.state = STATE_READY
        self.move_timer = 0.0
        self.dir_queue = deque()   # 缓存按键，避免一帧内连按丢方向

    @property
    def fps(self) -> int:
        level = self.eaten // SPEED_UP_EVERY
        return min(BASE_FPS + level * STEP_FPS, MAX_FPS)

    # -- 输入 -------------------------------------------------------------
    def handle_events(self) -> bool:
        """返回 False 表示要退出程序。"""
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False

            if event.type == pygame.KEYDOWN:
                k = event.key

                if k == pygame.K_ESCAPE:
                    return False

                # 方向键 / WASD
                mapping = {
                    pygame.K_UP: UP, pygame.K_w: UP,
                    pygame.K_DOWN: DOWN, pygame.K_s: DOWN,
                    pygame.K_LEFT: LEFT, pygame.K_a: LEFT,
                    pygame.K_RIGHT: RIGHT, pygame.K_d: RIGHT,
                }
                if k in mapping:
                    if self.state == STATE_READY:
                        self.state = STATE_PLAYING
                    if self.state == STATE_PLAYING:
                        # 与队列里最后一个方向比较，避免快速连按反向自杀
                        last = self.dir_queue[-1] if self.dir_queue else self.snake.direction
                        nd = mapping[k]
                        if (nd[0], nd[1]) != (-last[0], -last[1]) and nd != last:
                            self.dir_queue.append(nd)

                # 空格：暂停 / 继续
                if k == pygame.K_SPACE:
                    if self.state == STATE_PLAYING:
                        self.state = STATE_PAUSED
                    elif self.state == STATE_PAUSED:
                        self.state = STATE_PLAYING

                # R：重新开始
                if k == pygame.K_r and self.state in (STATE_OVER, STATE_PAUSED):
                    self.reset()

                # 结束时回车也能重开
                if k in (pygame.K_RETURN, pygame.K_KP_ENTER) and self.state == STATE_OVER:
                    self.reset()
        return True

    # -- 逻辑更新 ---------------------------------------------------------
    def update(self, dt: float) -> None:
        if self.state != STATE_PLAYING:
            return

        self.move_timer += dt
        interval = 1.0 / self.fps

        # 用 while 保证低帧率下也不会漏步
        while self.move_timer >= interval:
            self.move_timer -= interval
            self.step()

    def step(self) -> None:
        # 先消费一个缓存方向
        if self.dir_queue:
            self.snake.set_direction(self.dir_queue.popleft())

        # 预判碰撞
        if self.snake.hits_wall() or self.snake.hits_self():
            self.state = STATE_OVER
            if self.score > self.high_score:
                self.high_score = self.score
                save_high_score(self.high_score)
            return

        eat = self.snake.next_head() == self.food.pos
        self.snake.move(grow=eat)
        if self.snake.pending_growth > 0:
            self.snake.pending_growth -= 1

        if eat:
            self.score += 10
            self.eaten += 1
            self.food.respawn(self.snake.cells())

    # -- 渲染 -------------------------------------------------------------
    def draw(self) -> None:
        self.screen.fill(C_BG)
        self._draw_grid()
        self._draw_food()
        self._draw_snake()
        self._draw_info()
        self._draw_overlay()
        pygame.display.flip()

    def _draw_grid(self) -> None:
        for x in range(GRID_W + 1):
            px = x * CELL
            pygame.draw.line(self.screen, C_GRID, (px, INFO_H), (px, WIN_H))
        for y in range(GRID_H + 1):
            py = INFO_H + y * CELL
            pygame.draw.line(self.screen, C_GRID, (0, py), (WIN_W, py))

    def _cell_rect(self, cx, cy):
        return pygame.Rect(cx * CELL + 2, INFO_H + cy * CELL + 2, CELL - 4, CELL - 4)

    def _draw_food(self) -> None:
        if self.food.pos[0] < 0:
            return
        rect = self._cell_rect(*self.food.pos)
        pygame.draw.ellipse(self.screen, C_FOOD_EDGE, rect.inflate(2, 2))
        pygame.draw.ellipse(self.screen, C_FOOD, rect)
        # 高光
        hl = pygame.Rect(rect.x + rect.w * 0.25, rect.y + rect.h * 0.2,
                         rect.w * 0.25, rect.h * 0.22)
        pygame.draw.ellipse(self.screen, (255, 190, 188), hl)

    def _draw_snake(self) -> None:
        cells = self.snake.cells()
        n = len(cells)
        for i, (cx, cy) in enumerate(cells):
            t = i / max(1, n - 1)
            if i == 0:
                color = C_SNAKE_HEAD
            elif t < 0.5:
                color = lerp_color(C_SNAKE_HEAD, C_SNAKE_BODY, t * 2)
            else:
                color = lerp_color(C_SNAKE_BODY, C_SNAKE_TAIL, (t - 0.5) * 2)
            rect = self._cell_rect(cx, cy)
            radius = 9 if i == 0 else 7
            pygame.draw.rect(self.screen, color, rect, border_radius=radius)

        # 给蛇头画眼睛（朝向）
        hx, hy = cells[0]
        dx, dy = self.snake.direction
        head = self._cell_rect(hx, hy)
        ez = 3
        cx = head.centerx + dx * 5
        cy = head.centery + dy * 5
        if dx != 0:  # 水平朝向：眼睛上下排
            e1 = (cx, cy - 4)
            e2 = (cx, cy + 4)
        else:        # 垂直朝向：眼睛左右排
            e1 = (cx - 4, cy)
            e2 = (cx + 4, cy)
        for e in e1, e2:
            pygame.draw.circle(self.screen, (255, 255, 255), e, ez + 1)
            pygame.draw.circle(self.screen, (22, 30, 44), e, ez - 1)

    def _draw_info(self) -> None:
        pygame.draw.rect(self.screen, C_INFO_BG, (0, 0, WIN_W, INFO_H))
        pygame.draw.line(self.screen, C_INFO_LINE, (0, INFO_H), (WIN_W, INFO_H), 2)

        t_score = self.font_mid.render(f"得分 {self.score}", True, C_TEXT)
        self.screen.blit(t_score, (18, INFO_H // 2 - t_score.get_height() // 2))

        t_high = self.font_small.render(
            f"最高 {self.high_score}", True, C_TEXT_DIM)
        self.screen.blit(t_high, (18, INFO_H // 2 + 8))

        sp = self.font_small.render(f"速度 {self.fps}", True, C_TEXT_DIM)
        self.screen.blit(sp, (WIN_W - sp.get_width() - 18,
                              INFO_H // 2 - sp.get_height() // 2))

    def _draw_overlay(self) -> None:
        if self.state == STATE_PLAYING:
            return

        veil = pygame.Surface((WIN_W, WIN_H - INFO_H), pygame.SRCALPHA)
        veil.fill((20, 28, 42, 120))
        self.screen.blit(veil, (0, INFO_H))

        if self.state == STATE_READY:
            title, sub = "贪吃蛇", "按 方向键 / WASD 开始"
        elif self.state == STATE_PAUSED:
            title, sub = "已暂停", "空格继续 · R 重开"
        else:
            title, sub = "游戏结束", f"本局得分 {self.score} · 回车或 R 重开"

        t1 = self.font_big.render(title, True, (255, 255, 255))
        t2 = self.font_small.render(sub, True, (226, 232, 240))

        cy = INFO_H + (WIN_H - INFO_H) // 2
        self.screen.blit(t1, (WIN_W // 2 - t1.get_width() // 2, cy - 46))
        self.screen.blit(t2, (WIN_W // 2 - t2.get_width() // 2, cy + 12))

    # -- 主循环 -----------------------------------------------------------
    def run(self) -> None:
        running = True
        while running:
            dt = self.clock.tick(60) / 1000.0
            running = self.handle_events()
            self.update(dt)
            self.draw()
        pygame.quit()


def main():
    Game().run()


if __name__ == "__main__":
    main()
