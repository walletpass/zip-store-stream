import { dataToBuffer } from './data-to-bytes';
import { Readable } from 'stream';

const FILE_HEADER_PROLOGUE = Buffer.from([
  // version + bit flag
  0x0a,
  0x00,
  0x00,
  0x00,
  // compression method - this is STORE, means no compression
  0x00,
  0x00,
  // file time - we will put nothing here
  0x00,
  0x00,
  // file date - we will put nothing here
  0x00,
  0x00,
]);
const FILE_DATA_PROLOGUE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DIRECTORY_ENTRY_PROLOGUE = Buffer.from([
  0x50,
  0x4b,
  0x01,
  0x02,
  0x14,
  0x00,
]);
const ZIP_PROLOGUE = Buffer.from([
  0x50,
  0x4b,
  0x05,
  0x06,
  0x00,
  0x00,
  0x00,
  0x00,
]);

interface ZipSource {
  path: string;
  data: string | Buffer | Readable;
}

export class ZipStoreStream extends Readable {
  private readonly files: ZipSource[];
  private finished = false;
  private readonly numberOfFiles: number;
  private readonly centralDirectory: number[] = [];
  private filesDataWritten = 0;
  constructor(files: ZipSource[]) {
    super();
    this.files = files;
    this.numberOfFiles = this.files.length;
  }

  async _read(): Promise<void> {
    if (this.files.length) {
      // getting next file to pipe
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { path, data } = this.files.shift()!;

      const { bytes, crc32 } = await dataToBuffer.call(this, data);
      // We support only ASCII encoded file names here
      const pathBytes = Buffer.from(path, 'ascii');

      // Generate a file header (as a buffer)
      const fileHeader = Buffer.alloc(16, 0);
      // crc32
      let offset = fileHeader.writeUInt32LE(crc32);
      // compressed size
      offset = fileHeader.writeUInt32LE(bytes.length, offset);
      // uncompressed size
      offset = fileHeader.writeUInt32LE(bytes.length, offset);
      // file name length
      fileHeader.writeUInt16LE(pathBytes.length, offset);

      const directoryEntryMeta = Buffer.alloc(14, 0);
      /*
      comment length, disk start, file attributes
        [0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
      external file attributes
        [0x00, 0x00, 0x00, 0x00]
    */
      // relative offset of local header
      directoryEntryMeta.writeUInt32LE(this.filesDataWritten, 10);
      this.centralDirectory.push(
        ...DIRECTORY_ENTRY_PROLOGUE,
        ...FILE_HEADER_PROLOGUE,
        ...fileHeader,
        ...directoryEntryMeta,
        ...pathBytes,
      );

      this.push(FILE_DATA_PROLOGUE);
      this.push(FILE_HEADER_PROLOGUE);
      this.push(fileHeader);
      this.push(pathBytes);
      // update offset
      this.filesDataWritten +=
        FILE_DATA_PROLOGUE.length +
        FILE_HEADER_PROLOGUE.length +
        fileHeader.length +
        pathBytes.length +
        bytes.length;
      this.push(bytes);
    }
    // end if there is no more files
    else {
      if (!this.finished) {
        this.finished = true;
        // writing central directory
        this.push(Buffer.from(this.centralDirectory));

        // ending ZIP file
        this.push(ZIP_PROLOGUE);
        const zipFinal = Buffer.alloc(14, 0);
        let offset = zipFinal.writeUInt16LE(this.numberOfFiles, 0);
        offset = zipFinal.writeUInt16LE(this.numberOfFiles, offset);
        offset = zipFinal.writeUInt32LE(this.centralDirectory.length, offset);
        zipFinal.writeUInt32LE(this.filesDataWritten, offset);
        this.push(zipFinal);

        // push the EOF-signaling `null` chunk.
        this.push(null);
      }
    }
  }
}
