import Jimp from 'jimp';

export default class ImageProcessor {
    private width: number;
    private height: number;
    private inputFile: string;
    private image: Jimp;

    public constructor(inputFile: string, stringLength: number, maxFrames: number) {
        this.inputFile = inputFile;
        this.width = stringLength;
        Jimp.read(this.inputFile).then(image => {
            this.image = image;
            if ((this.width = image.getWidth()) != stringLength || (this.height = image.getHeight()) > maxFrames) {
                throw 'Image is wrong dimensions';
            }
        });
    }

    public getSize() {
        return this.height;
    }

    public getColor(lightIndex: number, frame: number) {
        return Jimp.intToRGBA(this.image.getPixelColor(lightIndex, frame));
    }

    public getBuffer() {
        const imageBuffers = new Array<Buffer>();
        let offset = 0;
        for (let y = 0; y < this.height; y++) {
            imageBuffers[y] = this.getFrameBuffer(y);
            offset += imageBuffers[y].length;
        }
        return Buffer.concat(imageBuffers);
    }

    public getFrameBuffer(frame: number) {
        const imageBuffer = Buffer.alloc(this.width * 3);
        let offset = 0;
        for (let x = 0; x < this.width; x++) {
            const pixel = this.getColor(x, frame);
            imageBuffer.writeUInt8(pixel.r, offset);
            imageBuffer.writeUInt8(pixel.g, offset + 1);
            imageBuffer.writeUInt8(pixel.b, offset + 2);
            offset += 3;
        }
        return imageBuffer;
    }

    public * getBufferIterator() {
        for (let y = 0; y < this.height; y++) {
            yield this.getFrameBuffer(y);
        }
        return this.height;
    }
}