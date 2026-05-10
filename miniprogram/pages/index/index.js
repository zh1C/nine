// pages/index/index.js

// ========== 粒子系统 ==========

// 基础粒子类
class Particle {
  constructor(x, y, color, options = {}) {
    this.x = x;
    this.y = y;
    this.color = color;
    const angle = options.angle !== undefined ? options.angle : Math.random() * Math.PI * 2;
    const speed = options.speed !== undefined ? options.speed : Math.random() * 4 + 1;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.alpha = 1;
    this.decay = options.decay || (Math.random() * 0.012 + 0.006);
    this.size = options.size || (Math.random() * 3 + 1);
    this.twinkle = options.twinkle || false; // 闪烁效果
    this.twinkleSpeed = Math.random() * 0.1 + 0.05;
    this.twinklePhase = Math.random() * Math.PI * 2;
    this.frameCount = 0;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.035; // 重力
    this.vx *= 0.985; // 空气阻力
    this.alpha -= this.decay;
    this.frameCount++;
  }

  draw(ctx) {
    let alpha = this.alpha;
    if (this.twinkle) {
      alpha *= 0.5 + 0.5 * Math.sin(this.frameCount * this.twinkleSpeed + this.twinklePhase);
    }
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// 尾迹火花粒子（用于升空拖尾）
class TrailParticle {
  constructor(x, y) {
    this.x = x + (Math.random() - 0.5) * 4;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 1;
    this.vy = Math.random() * 1 + 0.5;
    this.alpha = 1;
    this.size = Math.random() * 2 + 0.5;
    this.color = Math.random() > 0.5 ? '#FFD700' : '#FFA500';
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 0.04;
    this.size *= 0.96;
  }

  draw(ctx) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Emoji 飘落粒子
class EmojiParticle {
  constructor(canvasWidth, canvasHeight) {
    const emojis = ['🎂', '🎈', '🎁', '🎉', '⭐', '🎊', '💫', '🌟', '🎵', '❤️'];
    this.emoji = emojis[Math.floor(Math.random() * emojis.length)];
    this.x = Math.random() * canvasWidth;
    this.y = -30;
    this.vy = Math.random() * 1 + 0.5; // 下落速度
    this.vx = 0;
    this.swingSpeed = Math.random() * 0.03 + 0.01; // 左右摇摆速度
    this.swingAmp = Math.random() * 20 + 10; // 摇摆幅度
    this.phase = Math.random() * Math.PI * 2;
    this.size = Math.random() * 8 + 14; // 字体大小 14~22
    this.alpha = 0.7 + Math.random() * 0.3;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.02;
    this.frameCount = 0;
    this.canvasHeight = canvasHeight;
  }

  update() {
    this.frameCount++;
    this.y += this.vy;
    this.x += Math.sin(this.frameCount * this.swingSpeed + this.phase) * 0.8;
    this.rotation += this.rotationSpeed;
  }

  draw(ctx) {
    if (this.y > this.canvasHeight + 30) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.font = `${this.size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, 0, 0);
    ctx.restore();
  }

  isDead() {
    return this.y > this.canvasHeight + 30;
  }
}

// 烟花类（增强版）
class Firework {
  constructor(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.x = Math.random() * canvasWidth * 0.6 + canvasWidth * 0.2;
    this.y = canvasHeight;
    this.targetY = Math.random() * canvasHeight * 0.3 + canvasHeight * 0.1;
    this.speed = Math.random() * 3 + 4;
    this.exploded = false;
    this.particles = [];
    this.trailParticles = []; // 升空尾迹
    // 随机选择爆炸类型：普通(60%)、心形(20%)、星形(20%)
    const rand = Math.random();
    if (rand < 0.2) {
      this.explodeType = 'heart';
    } else if (rand < 0.4) {
      this.explodeType = 'star';
    } else {
      this.explodeType = 'normal';
    }
  }

  update() {
    if (!this.exploded) {
      this.y -= this.speed;
      // 生成尾迹火花
      if (Math.random() < 0.6) {
        this.trailParticles.push(new TrailParticle(this.x, this.y));
      }
      // 更新尾迹
      this.trailParticles.forEach(t => t.update());
      this.trailParticles = this.trailParticles.filter(t => t.alpha > 0);

      if (this.y <= this.targetY) {
        this.explode();
      }
    } else {
      this.particles.forEach(p => p.update());
      this.particles = this.particles.filter(p => p.alpha > 0);
      // 尾迹继续衰减
      this.trailParticles.forEach(t => t.update());
      this.trailParticles = this.trailParticles.filter(t => t.alpha > 0);
    }
  }

  explode() {
    this.exploded = true;
    // 多色渐变：选 2 个颜色做渐变
    const colorSets = [
      ['#FF6B6B', '#FFD93D'], // 红→黄
      ['#4D96FF', '#C678FF'], // 蓝→紫
      ['#6BCB77', '#00D2D3'], // 绿→青
      ['#FF6B9D', '#FF9F43'], // 粉→橙
      ['#FFD700', '#FF4500'], // 金→红
      ['#00D2D3', '#4D96FF'], // 青→蓝
    ];
    const colorPair = colorSets[Math.floor(Math.random() * colorSets.length)];

    switch (this.explodeType) {
      case 'heart':
        this.explodeHeart(colorPair);
        break;
      case 'star':
        this.explodeStar(colorPair);
        break;
      default:
        this.explodeNormal(colorPair);
    }

    // 振动反馈
    try { wx.vibrateShort({ type: 'light' }); } catch (e) { }
  }

  // 普通圆形爆炸（多色渐变 + 闪烁）
  explodeNormal(colorPair) {
    const particleCount = 55 + Math.floor(Math.random() * 25);
    for (let i = 0; i < particleCount; i++) {
      const t = i / particleCount;
      const color = this.lerpColor(colorPair[0], colorPair[1], t);
      const twinkle = Math.random() < 0.3;
      this.particles.push(new Particle(this.x, this.y, color, { twinkle }));
    }
  }

  // 心形爆炸
  explodeHeart(colorPair) {
    const particleCount = 80;
    for (let i = 0; i < particleCount; i++) {
      const t = (i / particleCount) * Math.PI * 2;
      // 心形参数方程
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      const scale = 0.18 + Math.random() * 0.04;
      const color = this.lerpColor(colorPair[0], colorPair[1], i / particleCount);
      this.particles.push(new Particle(this.x, this.y, color, {
        angle: Math.atan2(hy, hx),
        speed: Math.sqrt(hx * hx + hy * hy) * scale,
        decay: Math.random() * 0.008 + 0.005,
        size: Math.random() * 2.5 + 1.5,
        twinkle: true,
      }));
    }
  }

  // 星形爆炸
  explodeStar(colorPair) {
    const points = 5;
    const particleCount = 70;
    for (let i = 0; i < particleCount; i++) {
      const armAngle = (Math.floor(i / (particleCount / points)) / points) * Math.PI * 2 - Math.PI / 2;
      const spread = (Math.random() - 0.5) * 0.3; // 射线内随机偏移
      const angle = armAngle + spread;
      const speed = Math.random() * 3 + 2;
      const color = this.lerpColor(colorPair[0], colorPair[1], i / particleCount);
      this.particles.push(new Particle(this.x, this.y, color, {
        angle,
        speed,
        decay: Math.random() * 0.01 + 0.006,
        size: Math.random() * 2.5 + 1,
        twinkle: Math.random() < 0.4,
      }));
    }
  }

  // 颜色插值
  lerpColor(c1, c2, t) {
    const r1 = parseInt(c1.slice(1, 3), 16);
    const g1 = parseInt(c1.slice(3, 5), 16);
    const b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16);
    const g2 = parseInt(c2.slice(3, 5), 16);
    const b2 = parseInt(c2.slice(5, 7), 16);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  }

  draw(ctx) {
    // 绘制尾迹
    this.trailParticles.forEach(t => t.draw(ctx));

    if (!this.exploded) {
      // 升空的亮点（稍大一点）
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      this.particles.forEach(p => p.draw(ctx));
    }
  }

  isDead() {
    return this.exploded && this.particles.length === 0 && this.trailParticles.length === 0;
  }
}

Page({
  data: {
    userInfo: null,
    isAdmin: false,
    showFirework: false,
    celebrationMessage: '',
  },

  onLoad() {
    this.checkLogin();
    this.checkCelebration();
  },

  onShow() {
    this.checkLogin();
  },

  checkLogin() {
    const app = getApp();
    if (!app.globalData.isLogin) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }
    const userInfo = app.globalData.userInfo;
    this.setData({
      userInfo,
      isAdmin: userInfo && userInfo.role === "admin",
    });
  },

  // ========== 庆祝动画 ==========
  async checkCelebration() {
    const app = getApp();
    const username = app.globalData.userInfo && app.globalData.userInfo.username;
    if (!username) return;

    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: { type: "checkCelebration", username },
      });
      const record = res.result && res.result.data;
      if (!record) return; // 无需播放

      this.celebrationRecordId = record._id;
      this.setData({
        showFirework: true,
        celebrationMessage: record.message || '生日快乐！🎂',
      });
      this.startFirework();
    } catch (e) {
      // 查询失败静默处理
    }
  },

  startFirework() {
    const query = wx.createSelectorQuery();
    query.select('#fireworkCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const info = wx.getWindowInfo();
        const dpr = info.pixelRatio;
        const width = res[0].width;
        const height = res[0].height;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        let fireworks = [];
        let emojis = [];
        let frameCount = 0;
        this._animating = true;

        const animate = () => {
          if (!this._animating) return;

          // 半透明黑色覆盖实现拖尾效果
          ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
          ctx.fillRect(0, 0, width, height);

          // 生成新烟花
          if (frameCount % 22 === 0 || (frameCount > 10 && Math.random() < 0.045)) {
            fireworks.push(new Firework(width, height));
          }

          // 生成 Emoji 飘落
          if (frameCount % 18 === 0 || Math.random() < 0.03) {
            emojis.push(new EmojiParticle(width, height));
          }

          // 更新和绘制烟花
          fireworks.forEach(f => {
            f.update();
            f.draw(ctx);
          });
          fireworks = fireworks.filter(f => !f.isDead());

          // 更新和绘制 Emoji
          emojis.forEach(e => {
            e.update();
            e.draw(ctx);
          });
          emojis = emojis.filter(e => !e.isDead());

          frameCount++;
          canvas.requestAnimationFrame(animate);
        };

        animate();

        // 10秒后自动关闭
        this._fireworkTimer = setTimeout(() => {
          this.closeFirework();
        }, 10000);
      });
  },

  closeFirework() {
    if (!this.data.showFirework) return;
    this._animating = false;
    if (this._fireworkTimer) {
      clearTimeout(this._fireworkTimer);
      this._fireworkTimer = null;
    }
    this.setData({ showFirework: false });

    // 播放完成后消耗次数
    if (this.celebrationRecordId) {
      wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: { type: "consumeCelebration", recordId: this.celebrationRecordId },
      }).catch(() => { });
      this.celebrationRecordId = null;
    }
  },

  navigateTo(e) {
    const page = e.currentTarget.dataset.page;
    wx.navigateTo({ url: page });
  },

  handleLogout() {
    wx.showModal({
      title: "提示",
      content: "确定要退出登录吗？",
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync("userInfo");
          getApp().globalData.userInfo = null;
          getApp().globalData.isLogin = false;
          wx.reLaunch({ url: "/pages/login/login" });
        }
      },
    });
  },

  // 转发给朋友
  onShareAppMessage() {
    return {
      title: "9号菜单",
      path: "/pages/login/login",
    };
  },
});
