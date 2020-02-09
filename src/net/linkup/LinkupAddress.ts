class LinkupAddress {
    readonly serverURL : string;
    readonly linkupId  : string;

    constructor(serverURL: string, linkupId: string) {

        if (serverURL[serverURL.length-1] === '/') {
            serverURL = serverURL.substring(0, serverURL.length-1);
        }

        this.serverURL = serverURL;
        this.linkupId  = linkupId;
    }

    url() : string {
        return this.serverURL + '/' + this.linkupId;
    }

    static fromURL(url: string) {
        if (url[url.length-1] === '/') {
            url = url.substring(0, url.length-1);
        }

        let urlParts = url.split('/');
        let linkupId = urlParts.pop();
        urlParts.push('');
        let serverUrl = urlParts.join('/');

        return new LinkupAddress(serverUrl, linkupId as string);
    }

}

export { LinkupAddress };