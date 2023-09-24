import esbuild, { type BuildOptions, type BuildResult } from 'esbuild';
import { getGlobalVariables } from '@react-native-esbuild/internal';
import {
  setEnvironment,
  combineWithDefaultBundleConfig,
  getEsbuildOptions,
  getIdByOptions,
  type BundleConfig,
} from '@react-native-esbuild/config';
import type { LogLevel } from '@react-native-esbuild/utils';
import { Logger, colors, isCI, isTTY } from '@react-native-esbuild/utils';
import { CacheStorage } from '../cache';
import { logger } from '../shared';
import { BundleTaskSignal } from '../types';
import type {
  ReactNativeEsbuildConfig,
  BuildTask,
  BundleMode,
  BundlerAdditionalData,
  BundleResult,
  BundleRequestConfig,
  PromiseHandler,
  EsbuildPluginFactory,
  PluginContext,
  ReportableEvent,
} from '../types';
import {
  loadConfig,
  getConfigFromGlobal,
  createPromiseHandler,
  getTransformedPreludeScript,
} from './helpers';
import { BundlerEventEmitter } from './events';
import { createBuildStatusPlugin, createMetafilePlugin } from './plugins';
import { printLogo } from './logo';

export class ReactNativeEsbuildBundler extends BundlerEventEmitter {
  public static caches = CacheStorage.getInstance();
  private config: ReactNativeEsbuildConfig;
  private appLogger = new Logger('app');
  private buildTasks = new Map<number, BuildTask>();
  private plugins: ReturnType<EsbuildPluginFactory<unknown>>[] = [];

  public static initialize(): void {
    if (isCI() || !isTTY()) colors.disable();

    const config = loadConfig(process.cwd());

    config.logger?.enabled ?? true ? Logger.enable() : Logger.disable();
    Logger.setTimestampFormat(config.logger?.timestamp ?? null);

    if (!config.mainFields?.includes('react-native')) {
      logger.warn('`react-native` not found in `mainFields`');
    }

    if (!config.transformer?.stripFlowPackageNames?.includes('react-native')) {
      logger.warn('`react-native` not found in `stripFlowPackageNames`');
    }
  }

  constructor(private root: string = process.cwd()) {
    super();
    this.config = getConfigFromGlobal();
    this.on('report', (event) => {
      this.broadcastToReporter(event);
    });
    printLogo();
  }

  private broadcastToReporter(event: ReportableEvent): void {
    // default reporter (for logging)
    switch (event.type) {
      case 'client_log':
        this.appLogger[event.level as LogLevel](
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LogMessage in dev-server
          (event.data as any[]).join(' '),
        );
        break;
    }
  }

  private async getBuildOptionsForBundler(
    mode: BundleMode,
    bundleConfig: BundleConfig,
    additionalData?: BundlerAdditionalData,
  ): Promise<BuildOptions> {
    if (!this.plugins.length) {
      throw new Error('plugin is not registered');
    }

    setEnvironment(bundleConfig.dev);

    const context: PluginContext = {
      ...bundleConfig,
      id: this.identifyTaskByBundleConfig(bundleConfig),
      root: this.root,
      config: this.config,
      mode,
      additionalData,
    };

    const plugins = [
      /**
       * `build-status-plugin` is required and must be placed first
       */
      createBuildStatusPlugin({
        onStart: (context) => {
          this.handleBuildStart(context);
        },
        onUpdate: (buildState, context) => {
          this.handleBuildStateUpdate(buildState, context);
        },
        onEnd: (result, context) => {
          this.handleBuildEnd(result, context);
        },
      }),
      createMetafilePlugin(),
      ...this.plugins,
    ];

    return getEsbuildOptions(bundleConfig, {
      mainFields: this.config.mainFields,
      plugins: plugins.map((plugin) => plugin(context)),
      define: getGlobalVariables(bundleConfig),
      banner: {
        js: await getTransformedPreludeScript(bundleConfig, this.root),
      },
      write: mode === 'bundle',
    });
  }

  private identifyTaskByBundleConfig(bundleConfig: BundleConfig): number {
    return getIdByOptions(bundleConfig);
  }

  private assertBuildTask(task?: BuildTask): asserts task is BuildTask {
    if (task) return;
    throw new Error('unable to get build task');
  }

  private assertTaskHandler(
    handler?: PromiseHandler<BundleResult> | null,
  ): asserts handler is PromiseHandler<BundleResult> {
    if (handler) return;
    throw new Error('unable to get task handler');
  }

  private handleBuildStart(context: PluginContext): void {
    this.resetTask(context);
    this.emit('build-start', { id: context.id });
  }

  private handleBuildStateUpdate(
    buildState: {
      loaded: number;
      resolved: number;
    },
    context: PluginContext,
  ): void {
    this.emit('build-status-change', { id: context.id, ...buildState });
  }

  private handleBuildEnd(result: BuildResult, context: PluginContext): void {
    const bundleEndedAt = new Date();
    const bundleFilename = context.outfile;
    const bundleSourcemapFilename = `${bundleFilename}.map`;
    const revisionId = bundleEndedAt.getTime().toString();
    const { outputFiles } = result;

    // `outputFiles` available when only `write: false`
    if (outputFiles === undefined) return;

    const currentTask = this.buildTasks.get(context.id);
    this.assertBuildTask(currentTask);

    const findFromOutputFile = (
      filename: string,
    ): (<T extends { path: string }>(args: T) => boolean) => {
      return <T extends { path: string }>({ path }: T) =>
        path.endsWith(filename);
    };

    try {
      const bundleOutput = outputFiles.find(findFromOutputFile(bundleFilename));
      const bundleSourcemapOutput = outputFiles.find(
        findFromOutputFile(bundleSourcemapFilename),
      );

      if (!(bundleOutput && bundleSourcemapOutput)) {
        logger.warn('cannot found bundle and sourcemap');
        currentTask.handler?.rejecter?.(BundleTaskSignal.EmptyOutput);
        return;
      }

      currentTask.handler?.resolver?.({
        source: bundleOutput.contents,
        sourcemap: bundleSourcemapOutput.contents,
        bundledAt: bundleEndedAt,
        revisionId,
      });
    } catch (error) {
      currentTask.handler?.rejecter?.(error);
    } finally {
      currentTask.status = 'resolved';
      this.emit('build-end', {
        revisionId,
        id: context.id,
        additionalData: context.additionalData,
      });
    }
  }

  private async getOrCreateBundleTask(
    bundleConfig: BundleConfig,
    additionalData?: BundlerAdditionalData,
  ): Promise<BuildTask> {
    const targetTaskId = this.identifyTaskByBundleConfig(bundleConfig);

    if (!this.buildTasks.has(targetTaskId)) {
      logger.debug(`bundle task not registered (id: ${targetTaskId})`);
      const buildOptions = await this.getBuildOptionsForBundler(
        'watch',
        bundleConfig,
        additionalData,
      );
      const context = await esbuild.context(buildOptions);
      this.buildTasks.set(targetTaskId, {
        context,
        handler: createPromiseHandler(),
        status: 'pending',
        buildCount: 0,
      });
      await context.watch();
      logger.debug(`bundle task is now watching: (id: ${targetTaskId})`);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- set() if not exist
    return this.buildTasks.get(targetTaskId)!;
  }

  private resetTask(context: PluginContext): void {
    // task does not exist in bundle mode
    if (context.mode === 'bundle') return;

    const buildTaskId = context.id;
    const targetTask = this.buildTasks.get(buildTaskId);
    this.assertBuildTask(targetTask);
    logger.debug(`reset task (id: ${buildTaskId})`, {
      buildCount: targetTask.buildCount,
    });

    this.buildTasks.set(buildTaskId, {
      // keep previous esbuild context
      context: targetTask.context,
      // set status to pending and using new promise instance only when stale
      handler:
        targetTask.buildCount === 0
          ? targetTask.handler
          : createPromiseHandler(),
      status: 'pending',
      buildCount: targetTask.buildCount + 1,
    });
  }

  registerPlugin(plugin: ReturnType<EsbuildPluginFactory<unknown>>): this {
    this.plugins.push(plugin);
    return this;
  }

  async bundle(
    bundleConfig: Partial<BundleConfig>,
    additionalData?: BundlerAdditionalData,
  ): Promise<BuildResult> {
    const buildOptions = await this.getBuildOptionsForBundler(
      'bundle',
      combineWithDefaultBundleConfig(bundleConfig),
      additionalData,
    );
    return esbuild.build(buildOptions);
  }

  async getBundle(
    bundleConfig: BundleRequestConfig,
    additionalData?: BundlerAdditionalData,
  ): Promise<{
    source: Uint8Array;
    bundledAt: Date;
    revisionId: string;
  }> {
    const buildTask = await this.getOrCreateBundleTask(
      combineWithDefaultBundleConfig(bundleConfig),
      additionalData,
    );
    this.assertTaskHandler(buildTask.handler);

    const { source, bundledAt, revisionId } = await buildTask.handler.task;

    return {
      source,
      bundledAt,
      revisionId,
    };
  }

  async getSourcemap(
    bundleConfig: BundleRequestConfig,
    additionalData?: BundlerAdditionalData,
  ): Promise<{
    sourcemap: Uint8Array;
    bundledAt: Date;
    revisionId: string;
  }> {
    const buildTask = await this.getOrCreateBundleTask(
      combineWithDefaultBundleConfig(bundleConfig),
      additionalData,
    );
    this.assertTaskHandler(buildTask.handler);

    const { sourcemap, bundledAt, revisionId } = await buildTask.handler.task;

    return {
      sourcemap,
      bundledAt,
      revisionId,
    };
  }
}
