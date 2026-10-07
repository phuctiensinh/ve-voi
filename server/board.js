// Trạng thái bảng vẽ phía server: lịch sử thao tác (để người vào sau / nối lại đồng bộ được),
// nét đang vẽ dở, hoàn tác/làm lại. Có giới hạn để bộ nhớ không tăng vô hạn.
'use strict';

const W = 800, H = 600; // hệ toạ độ logic dùng chung cho mọi thiết bị

class Board {
  constructor({ maxPoints = 50000, maxActions = 3000 } = {}) {
    this.maxPoints = maxPoints;
    this.maxActions = maxActions;
    this.reset();
  }

  reset() {
    /** @type {Array<{type:'stroke',id:number,c:string,s:number,p:number[]}|{type:'fill',id:number,x:number,y:number,c:string}|{type:'clear',id:number}>} */
    this.actions = [];
    this.redoStack = [];
    this.live = null;
    this.points = 0;
    this.seq = 0;
    this.full = false;
  }

  /** Bắt đầu nét mới. Trả về nét hoặc null nếu bảng đã đầy. */
  start(c, s) {
    this.commit();
    if (this.actions.length >= this.maxActions) { this.full = true; return null; }
    this.live = { type: 'stroke', id: ++this.seq, c, s, p: [] };
    this.redoStack = [];
    return this.live;
  }

  /** Thêm điểm vào nét đang vẽ. `id` (nếu có) phải khớp nét hiện tại. */
  add(points, id) {
    if (!this.live || (id !== undefined && id !== null && id !== this.live.id)) return null;
    if (this.points + points.length / 2 > this.maxPoints) { this.full = true; return null; }
    for (const v of points) this.live.p.push(v);
    this.points += points.length / 2;
    return this.live;
  }

  /** Kết thúc nét; trả về id nét vừa xong (hoặc null). */
  end() {
    const id = this.live ? this.live.id : null;
    this.commit();
    return id;
  }

  commit() {
    if (this.live && this.live.p.length) this.actions.push(this.live);
    this.live = null;
  }

  fill(x, y, c) {
    this.commit();
    if (this.actions.length >= this.maxActions) { this.full = true; return null; }
    const a = { type: 'fill', id: ++this.seq, x, y, c };
    this.actions.push(a);
    this.redoStack = [];
    return a;
  }

  clear() {
    this.commit();
    const last = this.actions[this.actions.length - 1];
    if (!last || last.type === 'clear') return null;
    const a = { type: 'clear', id: ++this.seq };
    this.actions.push(a);
    this.redoStack = [];
    return a;
  }

  undo() {
    this.commit();
    const a = this.actions.pop();
    if (!a) return false;
    if (a.type === 'stroke') this.points -= a.p.length / 2;
    this.redoStack.push(a);
    this.full = false;
    return true;
  }

  redo() {
    const a = this.redoStack.pop();
    if (!a) return false;
    if (a.type === 'stroke') this.points += a.p.length / 2;
    this.actions.push(a);
    return true;
  }

  /** Ảnh chụp để đồng bộ: các thao tác đã xong + nét đang vẽ dở (để người mới vẽ tiếp được). */
  snapshot() {
    return {
      actions: this.actions,
      live: this.live ? { id: this.live.id, c: this.live.c, s: this.live.s, p: this.live.p } : null,
    };
  }
}

module.exports = { Board, W, H };
