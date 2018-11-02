/* Settings */
const PYNG_INTERVAL = 2 * 60 * 1000;
const IDLE_TIMEOUT = 30 * 60 * 1000;
const RETRY_ATTEMPTS = 6;
const RETRY_INTERVAL = 15 * 1000;
const AUTOSAVE_INTERVAL = 15 * 1000;

/* Main logic */
class Pyng {
  constructor(Jupyter) {
    this.Jupyter = Jupyter;
    this.token = null;
    this.activity = new ActivityTracker({timeout: IDLE_TIMEOUT});
    this.activity.start();
  }

  start() {
    this.Jupyter.notebook.events.one('kernel_ready.Kernel', () => {
      this.getToken()
        .then(token => this.token = token)
        .then(() => this.mainLoop())
        .catch(err => {
          console.log(error)
          this.stop();
        });
      setInterval(() => this.saveNotebook(), AUTOSAVE_INTERVAL);
    });
  }

  getToken() {
    const executeCallbackObject = (callback) => ({
      iopub: {
        output: (data) => data.content.text ? callback(data.content.text) : null
      }
    });
    return new Promise((resolve, reject) => {
      this.Jupyter.notebook.kernel.execute(
        '!curl "http://metadata.google.internal/computeMetadata/v1/instance/attributes/keep_alive_token" -H "Metadata-Flavor: Google" -s --fail',
        executeCallbackObject(output => resolve(output))
      );
    });
  }

  // The promise will resolve when idle behavior is detected, and will fail if unable to complete the request
  mainLoop() {
    console.log('Beginning pyng main loop');
    return new Promise((resolve, reject) => {
      const checkIdle = () => {
        if (!this.activity.isIdle) {
          retry(() => this.keepAlive(), RETRY_ATTEMPTS, RETRY_INTERVAL)
            .catch(reject)
        } else {
          console.log('Notebook is idle');
          this.stop();
          return resolve();
        }
      }
      this.interval = setInterval(() => checkIdle(), PYNG_INTERVAL);
    });
  }

  stop() {
    console.log('Stopping notebook pyng');
    if (this.interval) clearInterval(this.interval);
    if (this.activity) this.activity.stop();
  }

  keepAlive() {
    const context = this;
    return new Promise((resolve, reject) => {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "https://nebula.udacity.com/api/v1/remote/keep-alive");
      xhr.setRequestHeader("Authorization", "Star " + this.token);
      xhr.onload = function () {
        if (this.status >= 200 && this.status < 300) {
          resolve(xhr.response);
        } else {
          reject({
            status: this.status,
            statusText: xhr.statusText
          });
        }
      };
      xhr.onerror = function () {
        reject({
          status: this.status,
          statusText: xhr.statusText
        });
      };
      xhr.send();
    });
  }

  saveNotebook() {
    if (this.Jupyter.notebook.dirty) {
      this.Jupyter.notebook.save_notebook();
    }
  }
}

/* Keep track of when there is activity in the window */
class ActivityTracker {
  constructor({
      timeout,
      element = document,
      events = ['click', 'keydown', 'mousemove']
  }) {
    this.lastActivity = Date.now();
    this.timeout = timeout;
    this.events = events;
    this.element = element;
    this.updater = debounce(() => this.update(), 500);
  }

  update() {
    this.lastActivity = Date.now();
  }

  start() {
    return this.events.map((event) =>
      this.element.addEventListener(event, this.updater)
    );
  }

  stop() {
    return this.events.map((event) =>
      this.element.removeEventListener(event, this.updater)
    );
  }

  get isIdle() {
    const idle = Date.now() - this.lastActivity;
    return idle > this.timeout;
  }
}

/* Utility functions */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const retry = (func, count, delay) => {
  return new Promise((resolve, reject) => {
    const _retry = (func, count, delay, resolve, reject) => {
      func()
        .then(resolve)
        .catch(err => {
          if (count > 1) {
            return sleep(delay)
              .then(() => _retry(func, count-1, delay, resolve, reject))
              .catch(reject)
          } else {
            return reject(err);
          }
        })
    };
    _retry(func, count, delay, resolve, reject)
  });
}
const debounce = (func, wait, immediate) => {
    let timeout;
    return function() {
        const context = this;
        const args = arguments;
        const later = () => {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

/* Jupyter Notebook loading hook */
define([
  'base/js/namespace'
], (Jupyter) => ({
  load_ipython_extension: () => {
    const pyng = new Pyng(Jupyter);
    pyng.start();
  }
}));
