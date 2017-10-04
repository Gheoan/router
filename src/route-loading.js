import {activationStrategy, _buildNavigationPlan, ViewPortPlan} from './navigation-plan';
import { Router } from './router';
import { NavigationInstruction } from './navigation-instruction';
import { Next } from './pipeline';
import { Container } from "aurelia-dependency-injection";

export interface RouterComponent {
  viewModel: ConfiguresRouter;
  childContainer: Container & { getChildRouter: () => Router };
  router: Router;
  config;
  childRouter?: Router;
}

export class RouteLoader {
  loadRoute(router: Router, config: RouteConfig, navigationInstruction: NavigationInstruction): Promise<RouterComponent> {
    throw Error('Route loaders must implement "loadRoute(router, config, navigationInstruction)".');
  }
}

export class LoadRouteStep {
  static inject() { return [RouteLoader]; }

  routeLoader: RouteLoader;

  constructor(routeLoader: RouteLoader) {
    this.routeLoader = routeLoader;
  }

  run(navigationInstruction: NavigationInstruction, next: Next): Promise<Next> {
    return loadNewRoute(this.routeLoader, navigationInstruction)
      .then(next)
      .catch(next.cancel);
  }
}

function loadNewRoute(routeLoader: RouteLoader, navigationInstruction: NavigationInstruction) {
  let toLoad = determineWhatToLoad(navigationInstruction);
  let loadPromises = toLoad.map((current) => loadRoute(
    routeLoader,
    current.navigationInstruction,
    current.viewPortPlan
    )
  );

  return Promise.all(loadPromises);
}

interface ToLoad {
  viewPortPlan: ViewPortPlan;
  navigationInstruction: NavigationInstruction;
}

function determineWhatToLoad(navigationInstruction: NavigationInstruction, toLoad: Array<ToLoad> = []): ToLoad[] {
  let plan = navigationInstruction.plan!;

  for (let viewPortName in plan) {
    let viewPortPlan = plan[viewPortName];

    if (viewPortPlan.strategy === activationStrategy.replace) {
      toLoad.push({ viewPortPlan, navigationInstruction });

      if (viewPortPlan.childNavigationInstruction) {
        determineWhatToLoad(viewPortPlan.childNavigationInstruction, toLoad);
      }
    } else {
      let viewPortInstruction = navigationInstruction.addViewPortInstruction(
        viewPortName,
        viewPortPlan.strategy,
        viewPortPlan.prevModuleId,
        viewPortPlan.prevComponent);

      if (viewPortPlan.childNavigationInstruction) {
        viewPortInstruction.childNavigationInstruction = viewPortPlan.childNavigationInstruction;
        determineWhatToLoad(viewPortPlan.childNavigationInstruction, toLoad);
      }
    }
  }

  return toLoad;
}

function loadRoute(routeLoader: RouteLoader, navigationInstruction: NavigationInstruction, viewPortPlan: ViewPortPlan):Promise<NavigationInstruction> | undefined  {
  let moduleId = viewPortPlan.config.moduleId;

  return loadComponent(routeLoader, navigationInstruction, viewPortPlan.config).then((component) => {
    let viewPortInstruction = navigationInstruction.addViewPortInstruction(
      viewPortPlan.name,
      viewPortPlan.strategy,
      moduleId,
      component);

    let childRouter = component.childRouter;
    if (childRouter) {
      let path = navigationInstruction.getWildcardPath();

      return childRouter._createNavigationInstruction(path, navigationInstruction)
        .then((childInstruction) => {
          viewPortPlan.childNavigationInstruction = childInstruction;

          return _buildNavigationPlan(childInstruction)
            .then((childPlan) => {
              childInstruction.plan = childPlan;
              viewPortInstruction.childNavigationInstruction = childInstruction;

              return loadNewRoute(routeLoader, childInstruction);
            });
        });
    }

    return undefined;
  });
}

function loadComponent(routeLoader: RouteLoader, navigationInstruction: NavigationInstruction, config: RouteConfig): Promise<RouterComponent> {
  let router = navigationInstruction.router;
  let lifecycleArgs = navigationInstruction.lifecycleArgs;

  return routeLoader.loadRoute(router, config, navigationInstruction).then((component) => {
    let {viewModel, childContainer} = component;
    component.router = router;
    component.config = config;

    if ('configureRouter' in viewModel) {
      let childRouter = childContainer.getChildRouter();
      component.childRouter = childRouter;

      return childRouter.configure(c => viewModel.configureRouter(c, childRouter, ...lifecycleArgs))
        .then(() => component);
    }

    return component;
  });
}
