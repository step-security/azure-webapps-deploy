import * as core from '@actions/core';
import * as crypto from "crypto";
import fs from 'fs';
import axios, {isAxiosError} from 'axios'

import { ActionParameters, WebAppKind, appKindMap } from "./actionparameters";

import { AuthorizerFactory } from "azure-actions-webclient/AuthorizerFactory";
import { DEPLOYMENT_PROVIDER_TYPES } from "./DeploymentProvider/Providers/BaseWebAppDeploymentProvider";
import { DeploymentProviderFactory } from './DeploymentProvider/DeploymentProviderFactory';
import { IAuthorizer } from 'azure-actions-webclient/Authorizer/IAuthorizer';
import { ValidatorFactory } from './ActionInputValidator/ValidatorFactory';
import { VERSION } from './version';

async function validateSubscription() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'Azure/webapps-deploy';
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';

  core.info('');
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false) core.info('\u001b[32m✓ Free for public repositories\u001b[0m');
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  core.info('');

  if (repoPrivate === false) return;

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const body: Record<string, string> = { action: action || '' };
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl;
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body, { timeout: 3000 }
    );
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(`\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`);
      core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
      process.exit(1);
    }
    core.info('Timeout or API not reachable. Continuing to next step.');
  }
}

var prefix = !!process.env.AZURE_HTTP_USER_AGENT ? `${process.env.AZURE_HTTP_USER_AGENT}` : "";

export async function main() {
  await validateSubscription();
  let isDeploymentSuccess: boolean = true;

  try {
    // Set user agent variable
    let usrAgentRepo = crypto.createHash('sha256').update(`${process.env.GITHUB_REPOSITORY}`).digest('hex');
    let actionName = 'DeployWebAppToAzure';
    let userAgentString = (!!prefix ? `${prefix}+` : '') + `GITHUBACTIONS_${actionName}_${usrAgentRepo}_${VERSION}`;
    core.exportVariable('AZURE_HTTP_USER_AGENT', userAgentString);

    // Initialize action inputs
    let endpoint: IAuthorizer = !!core.getInput('publish-profile') ? null : await AuthorizerFactory.getAuthorizer();
    ActionParameters.getActionParams(endpoint);
    let type: DEPLOYMENT_PROVIDER_TYPES = null;

    if(!!endpoint) {
      type = DEPLOYMENT_PROVIDER_TYPES.SPN;
    }
    else {
      type = DEPLOYMENT_PROVIDER_TYPES.PUBLISHPROFILE;
    }

    // Validate action inputs
    let validator = await ValidatorFactory.getValidator(type);
    await validator.validate();

    var deploymentProvider = DeploymentProviderFactory.getDeploymentProvider(type);

    core.debug("Predeployment Step Started");
    await deploymentProvider.PreDeploymentStep();

    core.debug("Deployment Step Started");
    await deploymentProvider.DeployWebAppStep();
  }
  catch(error) {
    isDeploymentSuccess = false;

    if (error.statusCode == 403) {
      core.setFailed("The deployment to your web app failed with HTTP status code 403. \
      Your web app may have networking features enabled which are blocking access (such as Private Endpoints). \
      For more information about deploying to virtual network integrated web apps, please follow https://aka.ms/gha/deploying-to-network-secured-sites");
    } else {
      core.setFailed("Deployment Failed, " + error);
    }
  }
  finally {
      if(deploymentProvider != null) {
          await deploymentProvider.UpdateDeploymentStatus(isDeploymentSuccess);
      }

      // Reset AZURE_HTTP_USER_AGENT
      core.exportVariable('AZURE_HTTP_USER_AGENT', prefix);

      core.debug(isDeploymentSuccess ? "Deployment Succeeded" : "Deployment failed");
  }
}

main();
