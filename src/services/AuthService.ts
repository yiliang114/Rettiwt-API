// PACKAGE LIBS
import fetch from 'node-fetch';

// CUSTOM LIBS

// SERVICES
import { HttpMethods } from '../types/HTTP';
import { DatabaseService } from './DatabaseService';

// TYPES
import { GuestCredentials, AuthCredentials } from '../types/Authentication';

// HELPERS
import { guestTokenUrl, blankHeader } from './helper/Requests';
import { parseCookies } from './helper/Parser';

// CONFIGS
import { config } from '../config/env';

/**
 * @summary Handles authentication of http requests and other authentication related tasks
 */
export class AuthService extends DatabaseService {
    // MEMBER DATA
    private static instance: AuthService;                                    // To store the current instance of this service
    private credTable: string;                                               // To store the name of the table with authentication credentials
    private authToken: string;                                               // To store the common auth token
    private currentUser: AuthCredentials;                                    // To store the current authentication credentials
    private currentGuest: GuestCredentials;                                  // To store the current guest credentials
    private authCredList: AuthCredentials[];                                 // To store the cursored list of available authentication credentials
    private numCredentials: number;                                          // To store the total number of available auth credentials
    private credentialNum: number;                                           // To store the current credentials number

    // MEMBER METHODS
    private constructor() {
        // Initializing super class
        super(config['server']['db']['databases']['auth']['name'], config['server']['db']['databases']['auth']['tables']['cookies']);

        // Initializing member data
        this.credTable = config['server']['db']['databases']['auth']['tables']['cookies'];
        this.authToken = config['twitter']['auth']['authToken'];
        this.currentUser = { authToken: this.authToken, csrfToken: '', cookie: ''};
        this.currentGuest = { authToken: this.authToken, guestToken: '' };
    }

    /**
     * @summary Initializes asynchronous member data of AuthService
     */
    private async init(): Promise<void> {
        // Connecting to database
        this.connectDB()
        // Getting the list of credentials from the database
        .then(() => this.client.db(this.dbName).collection(this.credTable).find().project({ _id: 0 }).toArray())
        // Initializing the credentials' member data
        .then(creds => {
            //@ts-ignore
            this.authCredList = creds;
            this.numCredentials = this.authCredList.length;
            this.credentialNum = 0;
        })
        // If fetching of credentials from db failed
        .catch(err => {
            console.log("Failed to get authentication credentials from db");
            throw err;
        });
    }

    /**
     * @returns The active instance of AuthService
     */
    static async getInstance(): Promise<AuthService> {
        // If an instance doesn't exist already
        if(!this.instance) {
            // Creating a new instance
            this.instance = new AuthService();

            // Initializing async data and returning the new instance
            return this.instance.init()
            .then(() => this.instance)
            .catch(err => {
                console.log("Failed to initialize AuthService instance");
                throw err;
            });
        }
        // If an instance already exists
        else return this.instance;
    }

    /**
     * @summary Changes to current active credential to the next available
     */
    private async changeCredentials(): Promise<void> {
        // If all credentials have been use, reset credential number
        this.credentialNum = (this.credentialNum == this.numCredentials) ? 0 : this.credentialNum;

        // Changing current auth credentials to the next available one
        this.currentUser = this.authCredList[this.credentialNum];
        this.currentUser.authToken = this.authToken;
        this.credentialNum++;
    }

    /**
     * @summary Stores the authentication credentials extracted from the given headers into the database
     * @param headers The headers from which the cookies are to be extracted and stored
     */
    async storeCredentials(headers: Headers): Promise<Boolean> {
        // Parsing the cookies
        const cookies: string = parseCookies(headers);

        // Getting csrf token from the cookie using regex
        //@ts-ignore
        const csrfToken: string = cookies.match(/ct0=(?<token>[a|A|0-z|Z|9]+);/)?.groups.token;
        
        // Preparing the credentials to write
        const creds = { csrfToken: csrfToken, cookie: cookies };

        // Writing credentials to database
        return this.write(creds, this.credTable)
        // If write was successful, reinitializing credentials
        .then(() => this.init())
        .then(() => true)
        // If write failed
        .catch(err => {
            console.log("Failed to store credentials");
            throw err;
        });
    }

    /**
     * @returns The current authentication credentials. A different credential is returned each time this is invoked
     * @param newCred Whether to get a different credential or the current one
     */
    async getAuthCredentials(newCred: boolean = true): Promise<{ authToken: string, csrfToken: string, cookie: string }> {
        // If new credential is required
        if(newCred) {
            // Changing credentials
            return this.changeCredentials()
            .then(() => this.currentUser)
            .catch(err => {
                console.log("Failed to switch to new credentials");
                throw err;
            });
        }
        // If new credential is not required
        else return this.currentUser;
    }

    /**
     * @returns The guest credentials required to fetch data anonymously
     * @param newCred Whether to get a different credential or the current one
     */
    async getGuestCredentials(newCred: boolean = true): Promise<{authToken: string, guestToken: string }> {
        // If new guest token is to used
        if(newCred || !this.currentGuest.guestToken) {
            // Fetching guest token from twitter api
            return fetch(guestTokenUrl(), {
                headers: blankHeader({ authToken: this.authToken }),
                method: HttpMethods.POST,
                body: null
            })
            .then(data => data.json())
            // Setting new guest credentials
            .then(data => {
                this.currentGuest.authToken = this.authToken;
                //@ts-ignore
                this.currentGuest.guestToken = data['guest_token'];
                return this.currentGuest;
            })
            .catch(err => {
                console.log("Failed to fetch new guest credentials");
                throw err;
            });
        }
        // If new guest credential is not required
        else return this.currentGuest;
    }
}