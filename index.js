'use strict';

const SlackBot = require('slackbots');
const config = require('./config.json');
const audioConfig = require('./audio-config.json');
let bars = require('./bars.json');
const Gpio = require('onoff').Gpio;
const Sound = require('node-aplay');
const describe = require('./describe.js')
const firebaseConfig = require('./firebase-config.js')
const os = require('os');
const say = require('say');
const firebase = require('firebase/app');
require('firebase/database');

const minSpinTimeMS = 15000;
const maxSpinTimeMS = 25000;

const portId = [5, 6, 13, 19, 26, 16, 20, 21];
const sensors = [];

const motor = new Gpio(4, 'out');

const WHEEL_SPINNING = 'SPINNING';
const WHEEL_IDLE = 'IDLE';
const BEERLOCATOR_SONG = new Sound(audioConfig.beerLocatorSong);
const TICK = new Sound(audioConfig.tick);

const TIMEOUT_AFTER_END = 11000;

let wheelState = WHEEL_IDLE;
let barIndex = 0;
let bot;
let previousIpAddress;


portId.forEach(port => sensors.push(new Gpio(port, 'in', 'falling')));

function updateLocations() {
    firebase.database().ref("/locations/").once('value').then(snapshot => {
        const locations = snapshot.val();
        bars = locations.map(location => ({ name: location }));
    });
}

function startup(){
    console.log('Starting bot...');
    bot = new SlackBot(config);
    bot.on('start', runBot);
}

function runBot(){
    console.log('Bot is online');
    const ipAddress = os.networkInterfaces().wlan0.filter(a => a.family === 'IPv4')[0].address;
    if (ipAddress !== previousIpAddress) {
        previousIpAddress = ipAddress;
        bot.postMessageToChannel('wheelofbeer', `I am back, my IP is: ${ipAddress}`, {
             icon_emoji: ':beer:',
        });
    }
    firebase.initializeApp(firebaseConfig);
    updateLocations();

    sensors.forEach((sensor, index) => {
        sensor.watch(() => {
          barIndex = (index + 6) % 8;
          console.log(`Sensor index ${index} => barIndex ${barIndex}`);
          TICK.play();
          console.log(sensors.map(sensor => {
              return sensor.readSync()
          }));
        });
    });

    bot.on('message', (data) => {
        if (data.type === 'message' && data.text) {
            if (data.text.toLowerCase() === 'time for beer') {
                if (wheelState === WHEEL_SPINNING) {
                    bot.postMessage(data.channel, 'wheel is still spinning, wait for it...', {
                         icon_emoji: ':beer:',
                    });
                }
                else if (wheelState === WHEEL_IDLE) {
                    const spinTime = minSpinTimeMS + (Math.random() * (maxSpinTimeMS - minSpinTimeMS));
                    bot.postMessage(data.channel, `Spinning wheel for ${ Math.floor(spinTime / 1000)} s, wait for it....`, {
                         icon_emoji: ':beer:',
                    });
                    motor.write(1);
                    BEERLOCATOR_SONG.play();

                    setTimeout(() => {
                        bot.postMessage(data.channel, 'Still spinning...', {
                             icon_emoji: ':beer:',
                        });
                    }, (spinTime / 2));

                    setTimeout(() => {
                        bot.postMessage(data.channel, 'Almost there...', {
                             icon_emoji: ':beer:',
                        });
                    }, ((spinTime / 2) + (spinTime / 4)));

                    setTimeout(() => {
                        bot.postMessage(data.channel, 'Just a bit longer...', {
                             icon_emoji: ':beer:',
                        });
                    }, (spinTime));

                    wheelState = WHEEL_SPINNING;
                    setTimeout(() => {
                        motor.write(0);
                        wheelState = WHEEL_IDLE;
                        setTimeout(() => {
                            var bar = bars[barIndex];
                            bot.postMessage(data.channel, describe.bar(bar), {
                                icon_emoji: ':beers:',
                            });
                        }, TIMEOUT_AFTER_END);
                    }, spinTime);
                    updateLocations();
                }
            } else if (data.text.toLowerCase() === 'trigger bar') {
                const bar = bars[barIndex];
                bot.postMessage(data.channel, describe.bar(bar), {
                    icon_emoji: ':beers:',
                });
            } else if (data.text.toLowerCase() === 'list bars') {
                const barList = bars.map(bar => bar.name).join('\n');
                bot.postMessage(data.channel, barList, {
                    icon_emoji: ':beers:',
                });
            } else if (data.text.startsWith('say: ')) {
                say.speak(data.text.substring(5));
            }
        }
    });

    bot.on('close', () => {
        console.log('Connection to slack closed');
        process.exit(1);
    });

    bot.on('error', (err) => {
        console.log(err);
        process.exit(1);
    });
}

startup();
