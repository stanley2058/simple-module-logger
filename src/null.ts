import { Writable } from "node:stream";

export function createNullWriteStream() {
  return new Writable({
    write(_chunk, _enc, cb) {
      cb(); // drop data
    },
  });
}
