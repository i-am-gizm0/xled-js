import { Writable } from "stream";
import Driver, { Mode } from "./index";
import { DeviceDetails } from "./Types";
import udp from 'dgram';
import ImageProcessor from "./ImageProcessor";
import { str2ab } from "./Util";
import atob from 'atob';

export default class LightsWritable extends Writable {
    private device: DeviceDetails;
    private ip: string;
    private token: string;
    private driver: Driver;
    
    private useFilePath: boolean;

    private udpClient: udp.Socket;

    private tokenInterval: NodeJS.Timeout;

    constructor({device, ip, token, driver, useFilePath = false}) {
        super();

        this.device = device;
        this.ip = ip;
        this.token = token;
        this.driver = driver;
        this.useFilePath = useFilePath;

        this.udpClient = udp.createSocket('udp4');

        this.tokenInterval = setInterval(async () => { this.token = atob(await driver.login()) }, 13000); // Expires in 14400, so renew around a second before that
    }

    _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error) => void) {
        if (this.useFilePath) {  // Is probably a file path
            chunk = new ImageProcessor(chunk.toString(), this.device.number_of_led, this.device.movie_capacity).getFrameBuffer(0);    // TODO: This is gonna be really slow
        }

        // TODO [#6]: Clean this up... there has to be a better way to do this
        // Generate the header
        let tokenArray = str2ab(this.token);
        let udpHeader = Buffer.alloc(tokenArray.length + 2);
        udpHeader.writeUInt8(0x01);
        udpHeader.fill(tokenArray, 1);
        udpHeader.writeUInt8(chunk.length / 3, tokenArray.length + 1);
        // Generate the body
        const data = Buffer.alloc(udpHeader.length + chunk.length);
        data.fill(udpHeader);
        data.fill(chunk, udpHeader.length);

        console.log(data);

        this.udpClient.send(data, 7777, this.ip, error => {
            if (error) {
                this.end();
                console.warn(error);
            }
            callback(error);
        });
    }

    // _final(callback: () => void) {
    //     this._destroy(undefined, callback);
    // }

    async _destroy(err: Error, callback: (error?: any) => void) {
        console.log('stopping writable');
        this.udpClient.close();
        this.driver.setMode(Mode.MOVIE).then(()=>callback(err));
        clearInterval(this.tokenInterval);
    }
}