import fs from 'fs';
import path from 'path';
import osenv from 'osenv';
import chalk from 'chalk';
import { parseYaml, safeDump } from '../../shared/yaml';
import { CACHE_FILE, FEFLOW_ROOT } from '../../shared/constant';
import { getPluginsList } from '../plugin/loadPlugins';

const internalPlugins = {
  devtool: '@feflow/feflow-plugin-devtool'
};

const NATIVE_TYPE = 'native';
const PLUGIN_TYPE = 'plugin';

const pluginRegex = new RegExp('feflow-plugin-(.*)', 'i');

export default class CommandPicker {
  cache: any;
  root: string;
  cmd: string;
  ctx: any;
  cacheFilePath: string;
  isHelp: boolean;

  constructor(ctx: any, cmd: string) {
    this.cache = {};
    this.root = ctx.root;
    this.ctx = ctx;
    this.cmd = cmd;
    this.cacheFilePath = path.join(this.root, CACHE_FILE);
    this.isHelp = ctx.args.h || ctx.args.help;

    this.init();

    if (this.isHelp) {
      this.cmd = 'help';
      this.pickCommand();
    }
  }

  isAvailable() {
    return this.isHelp ? false : !!this.getCommandConfig();
  }

  async init() {
    this.checkAndUpdate();
  }

  checkAndUpdate() {
    const { cacheFilePath } = this;
    if (!fs.existsSync(cacheFilePath)) {
      this.initCacheFile(cacheFilePath);
    } else {
      this.cache = parseYaml(cacheFilePath);
    }

    const { token: versionFromCache } = this.cache;
    if (!this.checkCacheToken(versionFromCache)) {
      this.initCacheFile(cacheFilePath);
    }
  }

  checkCacheToken(tokenFromCache: string) {
    return tokenFromCache === this.ctx.version;
  }

  getCacheToken() {
    return this.ctx.version;
  }

  initCacheFile(filePath: string) {
    const cacheObj: any = {};
    cacheObj.commandPickerMap = this.initCommandPickerMap();
    cacheObj.token = this.getCacheToken();
    safeDump(cacheObj, filePath);
    this.cache = cacheObj;
  }

  getCommandConfig() {
    return this.cache?.commandPickerMap?.[this.cmd];
  }

  initCommandPickerMap() {
    const commandPickerMap = {};
    const nativePath = path.join(__dirname, '../native');
    const logger = this.ctx.logger;

    // load native command
    fs.readdirSync(nativePath)
      .filter((file) => {
        return file.endsWith('.js');
      })
      .forEach((file) => {
        const command = file.split('.')[0];
        commandPickerMap[command] = {
          path: path.join(__dirname, '../native', file),
          type: NATIVE_TYPE
        };
      });

    // load internal plugins
    for (const command of Object.keys(internalPlugins)) {
      commandPickerMap[command] = {
        path: internalPlugins[command],
        type: PLUGIN_TYPE
      };
    }

    // load plugins
    const [err, plugins] = getPluginsList(this.ctx);
    const home = path.join(osenv.home(), FEFLOW_ROOT);

    if (!err) {
      for (const plugin of plugins) {
        const pluginPath = path.join(home, 'node_modules', plugin);
        // TODO
        // read plugin command from the key which from its package.json
        const command = (pluginRegex.exec(plugin) || [])[1];
        commandPickerMap[command] = {
          path: pluginPath,
          type: PLUGIN_TYPE
        };
      }
    } else {
      logger.debug('picker load plugin failed', err);
    }

    return commandPickerMap;
  }
  // 从配置文件中获取到当前命令的插件路径，然后注册进入commander
  pickCommand() {
    this.ctx.logger.debug('pickCommand');
    const { path, type } = this.getCommandConfig() || {};
    switch (type) {
      case NATIVE_TYPE:
      case PLUGIN_TYPE: {
        try {
          require(path)(this.ctx);
        } catch (error) {
          this.ctx.logger.error(
            { err: error },
            'command load failed: %s',
            chalk.magenta(name)
          );
        }
        break;
      }
      default: {
        this.ctx.logger.error(
          `this kind of command is not supported in command picker, ${type}`
        );
      }
    }
  }

  isUniverslPlugin() {
    const universalpluginList = this.ctx.universalPkg.getInstalled();
    const commandList = [];
    let isHited = false;

    for (const universal of universalpluginList) {
      const command = (pluginRegex.exec(universal[0]) || [])[1];
      commandList.push(command);
    }

    isHited = commandList.includes(this.cmd);
    this.ctx.logger.debug(
      `picker: this command ${isHited ? 'is' : 'is not'} universal plugin`
    );
    return isHited;
  }
}
