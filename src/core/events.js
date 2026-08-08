export class EventBus {
  constructor() { this.map = new Map(); }

  on(type, fn) {
    let arr = this.map.get(type);
    if (!arr) this.map.set(type, (arr = []));
    arr.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const arr = this.map.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  emit(type, payload) {
    const arr = this.map.get(type);
    if (arr) for (let i = 0; i < arr.length; i++) arr[i](payload);
    const any = this.map.get('*');
    if (any) for (let i = 0; i < any.length; i++) any[i](type, payload);
  }

  clear() { this.map.clear(); }
}
