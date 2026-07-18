import { describe, expect, it } from "vitest";
import { AddressPoolExhaustedError, SubnetAllocator } from "../src/ip-allocation/allocator.js";

describe("SubnetAllocator", () => {
  it("allocates sequential, block-aligned CIDRs from a supernet", () => {
    const allocator = new SubnetAllocator("10.0.0.0/24");
    expect(allocator.allocate(30)).toBe("10.0.0.0/30");
    expect(allocator.allocate(30)).toBe("10.0.0.4/30");
    expect(allocator.allocate(31)).toBe("10.0.0.8/31");
  });

  it("never hands out two overlapping blocks, even with mixed prefix lengths", () => {
    const allocator = new SubnetAllocator("10.0.0.0/24");
    const blocks = [
      allocator.allocate(28),
      allocator.allocate(31),
      allocator.allocate(30),
      allocator.allocate(32),
      allocator.allocate(32),
      allocator.allocate(29),
    ];
    expect(new Set(blocks).size).toBe(blocks.length);
    expect(allocator.allocatedBlocks()).toEqual(
      [...allocator.allocatedBlocks()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    );
  });

  it("is deterministic given the same call sequence", () => {
    const run = () => {
      const allocator = new SubnetAllocator("172.16.0.0/20");
      return [allocator.allocate(24), allocator.allocate(31), allocator.allocate(32)];
    };
    expect(run()).toEqual(run());
  });

  it("throws AddressPoolExhaustedError when the pool cannot satisfy a request", () => {
    const allocator = new SubnetAllocator("10.0.0.0/30");
    allocator.allocate(31);
    allocator.allocate(31);
    expect(() => allocator.allocate(31)).toThrow(AddressPoolExhaustedError);
  });

  it("rejects invalid prefix lengths", () => {
    const allocator = new SubnetAllocator("10.0.0.0/24");
    expect(() => allocator.allocate(-1)).toThrow(RangeError);
    expect(() => allocator.allocate(33)).toThrow(RangeError);
  });
});
