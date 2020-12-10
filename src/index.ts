import atob from 'atob';
import btoa from 'btoa';
import { EventEmitter } from 'events';
import { generate as generateString } from 'randomstring';
import fetch from 'node-fetch';

import ImageProcessor from './ImageProcessor';
import LightsWritable from './LightsWritable';
import { DeviceDetails, Timer, TokenResponse } from './Types';
import { sanitizeJSON } from './Util';

/** CONSTANTS */
const MAX_NAME_LENGTH = 32; // This is completely arbitrary, the device might allow higher values
const DEFAULT_KEEPALIVE = 5000;

export default class Driver extends EventEmitter {

    private IP:string;

    private baseURL:string;
    private loginURL:URL;
    private verifyURL:URL;

    private authToken:string;
    private tokenIssueTime:Date;
    private challengeResponse:string;

    private globalHeaders:{'X-Auth-Token':string};

    private keepaliveTimer: NodeJS.Timeout;
    
    public constructor(IP:string, keepaliveInterval = DEFAULT_KEEPALIVE) {
        super();
        this.IP = IP;
        this.baseURL = `http://${IP}/xled/v1`;
        this.loginURL = new URL(`${this.baseURL}/login`);
        this.verifyURL = new URL(`${this.baseURL}/verify`);
        // Set up and check the connection
        this.gestalt().then(value => {
            this.emit('connected', value);
        });
        this.globalHeaders = {
            'X-Auth-Token': undefined
        };
        this.keepaliveTimer = setInterval(()=>{
            try {
                this.gestalt()
            } catch (e) {
                clearInterval(keepaliveInterval);
                this.emit('disconnected', e);
            }
        }, keepaliveInterval);
    }

    // TODO [#7]: check if we need to log in and login if it fails
    public async login() {
        if (this.authToken && new Date().getTime() - this.tokenIssueTime.getTime() < 15000) {
            return;
        }
        const body = {
            challenge: btoa(generateString())
        }
        const response = await fetch(this.loginURL, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (!response.ok) {} // TODO: Handle bad response
        // TODO [#8]: TS should throw a TypeError here if the response doesn't contain everything so it should be handled
        const tokenData:TokenResponse = await response.json();
        this.authToken = tokenData.authentication_token;
        this.tokenIssueTime = new Date();
        this.globalHeaders["X-Auth-Token"] = this.authToken;
        // TODO [#9]: Verify response
        this.challengeResponse = tokenData["challenge-response"];

        await this.verify();
        return this.authToken;
    }

    private async verify() {
        const response = await fetch(this.verifyURL, {
            method: 'POST',
            headers: this.globalHeaders,
            body: this.challengeResponse
        });
        if (!response.ok) {}  // TODO: Handle bad response
        const verifyData = await response.json();   // TODO: Handle bad response
        if (!('code' in verifyData) || verifyData.code != 1000) {}  // TODO: Handle bad response
    }

    public async gestalt():Promise<DeviceDetails> {
        // await this.login(); 
        // TODO [#10]: gestalt times out sometimes when login is called again... this might be rudimentary rate limiting?
        //       if so, token checks should be implemented (login top-level TODO)

        const url = new URL(`${this.baseURL}/gestalt`);
        const response = await fetch(url, {
            headers: this.globalHeaders
        });

        if (!response.ok) {}    // TODO: Handle bad response
        const data = await response.json();
        const {code, ...details} = data;
        return details;   // TODO: parse response into object?
    }

    public async getName() {
        await this.login();

        const url = new URL(`${this.baseURL}/device_name`);
        const response = await fetch(url, {
            headers: this.globalHeaders
        });

        if (!response.ok){}   // TODO: Handle bad response
        const data:{code:number, name:string} = await response.json();
        return data.name;
    }

    public async setName(name:string) {
        if (name.length > MAX_NAME_LENGTH) {
            name = name.substr(0, MAX_NAME_LENGTH);
        }
        name = sanitizeJSON(name);

        await this.login();

        const url = new URL(`${this.baseURL}/device_name`);
        const body = {
            name
        }
        const response = await(fetch(url, {
            method: 'POST',
            headers: this.globalHeaders,
            body: JSON.stringify(body)
        }));
        if (!response.ok) {}
        return await this.getName();
    }

    public async getTimer() {
        await this.login();

        const url = new URL(`${this.baseURL}/timer`);
        const response = await fetch(url, {
            headers: this.globalHeaders
        });

        if (!response.ok){}   // TODO: Handle bad response
        const data:{code:number, time_now:number, time_on:number, time_off:number} = await response.json();
        const {code, ...rawTimer} = data;
        const timer:Timer = {
            now: rawTimer.time_now,
            on: rawTimer.time_on,
            off: rawTimer.time_off
        };
        return timer;
    }

    public async setTimer(timer:Timer, strictTime = false) {
        let newTimer = {
            time_now: this.validTimerValue(timer.now),
            time_on: this.validTimerValue(timer.on),
            time_off: this.validTimerValue(timer.off)
        }
        if (newTimer.time_now == -1 || strictTime) {
            const now = new Date();
            newTimer.time_now = ((now.getHours() * 60) + now.getMinutes()) * 60 + now.getSeconds();
        }

        await this.login();

        const url = new URL(`${this.baseURL}/timer`);
        const response = await(fetch(url, {
            method: 'POST',
            headers: this.globalHeaders,
            body: JSON.stringify(newTimer)
        }));
        if (!response.ok) {}
        return await this.getTimer();
    }

    private validTimerValue(x:number) {
        return (x >= 0 && x <= 86400) ? x : -1;
    }

    public async getMode() {
        await this.login();
        const url = new URL(`${this.baseURL}/led/mode`);
        const response = await fetch(url, {
            headers: this.globalHeaders
        });

        if (!response.ok){}   // TODO: Handle bad response
        const data = await response.json();
        this.emit('mode', Mode[data.mode]);
        this.emit(Mode[data.mode]);
        switch (data.mode) {
            case 'off':
                return Mode.OFF;
            case 'demo':
                return Mode.DEMO;
            case 'movie':
                return Mode.MOVIE;
            case 'rt':
                return Mode.RT;
        }
    }

    public async setMode(mode:Mode) {
        await this.login();

        const url = new URL(`${this.baseURL}/led/mode`);
        const body = {
            mode: Mode[mode].toLowerCase()
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: this.globalHeaders,
            body: JSON.stringify(body)
        });
        if (!response.ok) {};
        return await this.getMode();
    }

    // TODO [#11]: Add mode checks and persistence
    public async uploadMovie(image:string, fps = 25) {
        await this.login();
        const device = await this.gestalt();
        const processor = new ImageProcessor(image, device.number_of_led, device.movie_capacity);

        await this.reset();

        const movieURL = new URL(`${this.baseURL}/led/movie/full`);
        const movieHeaders = {
            ...this.globalHeaders,
            'Content-Type': 'application/octet-stream'
        };
        const movieResponse = await fetch(movieURL, {
            method: 'POST',
            headers: movieHeaders,
            body: processor.getBuffer()
        });
        if (!movieResponse.ok) {}
        const movieResponseData = await movieResponse.json();
        if (!('code' in movieResponseData) || !('frames_number' in movieResponseData) || movieResponseData['frames_number'] != processor.getSize()) {
            throw console.log(movieResponseData);
        }

        const configURL = new URL(`${this.baseURL}/led/movie/config`);
        const body = {
            'frame_delay': 1000 / fps,
            'leds_number': device.number_of_led,
            'frames_number': processor.getSize()
        };
        const configResponse = await fetch(configURL, {
            method: 'POST',
            headers: this.globalHeaders,
            body: JSON.stringify(body)
        });
        if (!configResponse.ok) {}

        await this.reset();

        await this.setMode(Mode.MOVIE);
    }

    public async startRealTimeStream(useFilePath=false) {
        await this.setMode(Mode.RT);
        
        return new LightsWritable({
            device: await this.gestalt(),
            ip: this.IP,
            token: atob(this.authToken),
            driver: this,
            useFilePath
        });
    }

    public async getBrightness() {
        await this.login();
        const url = new URL(`${this.baseURL}/led/out/brightness`);
        const response = await fetch(url, {
            headers: this.globalHeaders
        });

        if (!response.ok){}   // TODO: Handle bad response
        const responseData:{code:number, mode:'enabled'|'disabled', value:number} = await response.json();
        const {code, ...data} = responseData;
        return data;
    }
    
    public async setBrightness(value:number|false) {
        let enabled = value !== false ? 'enabled' : 'disabled';
        let brightness = value === false ? 100 : value;

        await this.login();

        const url = new URL(`${this.baseURL}/led/out/brightness`);
        const body = {
            mode: enabled,
            type: 'A',
            value: brightness
        }
        const response = await(fetch(url, {
            method: 'POST',
            headers: this.globalHeaders,
            body: JSON.stringify(body)
        }));
        if (!response.ok) {}
        return await this.getBrightness();
    }

    public async reset() {
        await this.login();

        const url = new URL(`${this.baseURL}/led/reset`);
        await fetch(url, {
            method: 'GET',
            headers: this.globalHeaders
        });
    }

    public close() {
        clearInterval(this.keepaliveTimer);
    }
}

export enum Mode {
    OFF,
    DEMO,
    MOVIE,
    RT
}

// module.exports = { Driver, Mode };