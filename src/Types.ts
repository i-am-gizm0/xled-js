export type TokenResponse = {
    authentication_token: string;
    authentication_token_expires_in: number;
    "challenge-response": string;
}

export type DeviceDetails = {
    product_name: string;
    product_version: string;
    hardware_version: string;
    flash_size: number;
    led_type: number;
    led_version: string;
    product_code: string;
    device_name: string;
    rssi?: number;
    uptime: string;
    hw_id: string;
    mac: string;
    uuid?: string;
    max_supported_led: number;
    base_leds_number: number;
    number_of_led: number;
    led_profile: string;
    frame_rate: number;
    movie_capacity: number;
    copyright: string;
}

export type Timer = {
    now: number;
    on: number;
    off: number;
}