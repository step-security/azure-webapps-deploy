var core = require("@actions/core");

import { DOMParser, Document } from '@xmldom/xmldom';
import { Kudu } from 'azure-actions-appservice-rest/Kudu/azure-app-kudu-service';

import RuntimeConstants from '../RuntimeConstants';

export interface ScmCredentials {
    uri: string;
    username: string;
    password: string;
}

export class PublishProfile {
    private _creds: ScmCredentials;
    private _appUrl: string;
    private _kuduService: any;
    private _appOS: string;
    private static _publishProfile: PublishProfile;

    private constructor(publishProfileContent: string) {
        try {
            let dom = PublishProfile.parseXml(publishProfileContent);
            this._creds = {
                uri: PublishProfile.getAttribute(dom, "publishUrl", false),
                username: PublishProfile.getAttribute(dom, "userName", true),
                password: PublishProfile.getAttribute(dom, "userPWD", true)
            };
            this._appUrl = PublishProfile.getAttribute(dom, "destinationAppUrl", false);
            if(this._creds.uri.indexOf("scm") < 0) {
                throw new Error("Publish profile does not contain kudu URL");
            }
            this._creds.uri = `https://${this._creds.uri}`;
            this._kuduService = new Kudu(this._creds.uri, {username: this._creds.username, password: this._creds.password});
        } catch(error) {
            core.error("Failed to fetch credentials from Publish Profile. For more details on how to set publish profile credentials refer https://aka.ms/create-secrets-for-GitHub-workflows");
            throw error;
        }
    }

    private static parseXml(content: string): Document {
        try {
            return new DOMParser().parseFromString(content, 'text/xml');
        } catch(error) {
            throw new Error('Content is not a valid XML object');
        }
    }

    // Equivalent of xpath string(//publishProfile/@<name>): value from the first publishProfile element that has the attribute
    private static getAttribute(dom: Document, name: string, isSecret: boolean): string {
        let profiles = dom.getElementsByTagName("publishProfile");
        for(let i = 0; i < profiles.length; i++) {
            if(profiles[i].hasAttribute(name)) {
                let value = profiles[i].getAttribute(name);
                if(!!value) {
                    if(isSecret) {
                        core.setSecret(value);
                    }
                    return value;
                }
                break;
            }
        }
        core.debug("Cannot find key: //publishProfile/@" + name);
        return "";
    }

    public static getPublishProfile(publishProfileContent: string) {
        if(!this._publishProfile) {
            this._publishProfile = new PublishProfile(publishProfileContent);
        }
        return this._publishProfile;
    }

    public get creds(): ScmCredentials {
        return this._creds;
    }

    public get appUrl(): string {
        return this._appUrl;
    }

    public get kuduService() {
        return this._kuduService;
    }

    public async getAppOS() {
        try {
            if(!this._appOS) {
                const appRuntimeDetails = await this._kuduService.getAppRuntime();
                this._appOS = appRuntimeDetails[RuntimeConstants.system][RuntimeConstants.osName];
                core.debug(`App Runtime OS: ${this._appOS}`);
            }
        } catch(error) {
            throw Error("Failed to get app runtime OS\n" + JSON.stringify(error));
        }
        return this._appOS;
    }

}