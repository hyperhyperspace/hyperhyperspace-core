
class Shuffle {
    static array(arr: Array<any>) : void {
        
        let idx = arr.length;
        
        while (0 !== idx) {
        
            let rndIdx = Math.floor(Math.random() * idx);
            idx -= 1;
        
            // swap
            let tmp = arr[idx];
            arr[idx] = arr[rndIdx];
            arr[rndIdx] = tmp;
        }
    }
}

export { Shuffle };