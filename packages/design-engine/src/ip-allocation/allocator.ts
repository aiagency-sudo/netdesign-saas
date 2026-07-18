import { formatCidr, parseCidr } from "./cidr.js";

interface Interval {
  start: number;
  end: number;
}

export class AddressPoolExhaustedError extends Error {}

/**
 * First-fit, block-aligned allocator over a single supernet.
 *
 * Each `allocate()` call scans forward from the start of the pool for the
 * first address, aligned to the requested block size, that does not overlap
 * any previously allocated block, and reserves it. Because every allocation
 * is checked against every prior one, the allocator can never hand out two
 * overlapping blocks regardless of call order or mixed prefix lengths — this
 * is what CLAUDE.md's "no overlapping subnets, ever" rule reduces to.
 *
 * Deterministic: the same sequence of `allocate()` calls against a fresh
 * allocator always produces the same blocks. Calling allocate() for smaller,
 * earlier-needed blocks first (mgmt, then loopbacks, then P2P, then VLANs)
 * naturally produces contiguous-ish ranges per category, since nothing else
 * has claimed the space in between yet.
 */
export class SubnetAllocator {
  private readonly poolStart: number;
  private readonly poolEnd: number;
  private readonly poolCidr: string;
  private allocated: Interval[] = [];

  constructor(supernetCidr: string) {
    const { network, size } = parseCidr(supernetCidr);
    this.poolStart = network;
    this.poolEnd = network + size;
    this.poolCidr = supernetCidr;
  }

  /** Allocates and returns the next available, block-aligned CIDR of the given prefix length. */
  allocate(prefixLength: number, label = "block"): string {
    if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
      throw new RangeError(`prefixLength must be an integer in [0, 32], got ${prefixLength}`);
    }
    const blockSize = 2 ** (32 - prefixLength);
    let candidate = Math.ceil(this.poolStart / blockSize) * blockSize;

    while (candidate + blockSize <= this.poolEnd) {
      const candidateEnd = candidate + blockSize;
      const overlaps = this.allocated.some((iv) => candidate < iv.end && candidateEnd > iv.start);
      if (!overlaps) {
        this.allocated.push({ start: candidate, end: candidateEnd });
        this.allocated.sort((a, b) => a.start - b.start);
        return formatCidr(candidate, prefixLength);
      }
      candidate += blockSize;
    }

    throw new AddressPoolExhaustedError(
      `Cannot allocate a /${prefixLength} block ("${label}") from ${this.poolCidr}: pool exhausted or too fragmented.`,
    );
  }

  /** All CIDR blocks allocated so far, in address order — handy for overlap assertions in tests. */
  allocatedBlocks(): string[] {
    return this.allocated.map((iv) => formatCidr(iv.start, 32 - Math.log2(iv.end - iv.start)));
  }
}
