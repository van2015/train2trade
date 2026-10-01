export class Interval {
  constructor(readonly from: number, readonly to: number) {}

  static endingAt(to: number, span: number): Interval {
    return new Interval(to - span, to);
  }

  get span(): number {
    return this.to - this.from;
  }

  contains(other: Interval): boolean {
    return other.from >= this.from && other.to <= this.to;
  }

  startsBefore(other: Interval): boolean {
    return this.from < other.from;
  }

  endsAfter(other: Interval): boolean {
    return this.to > other.to;
  }

  shift(delta: number): Interval {
    return new Interval(this.from + delta, this.to + delta);
  }

  expand(ratio: number): Interval {
    const buffer = this.span * ratio;
    return new Interval(this.from - buffer, this.to + buffer);
  }

  union(other: Interval): Interval {
    return new Interval(Math.min(this.from, other.from), Math.max(this.to, other.to));
  }

  movedTo(post: Interval): Interval | null {
    if (post.from !== this.from) return this.shift(post.from - this.from);
    if (post.to !== this.to) return this.shift(post.to - this.to);
    return null;
  }
}
