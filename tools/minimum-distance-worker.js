import {computeSurfaceDistance} from './minimum-distance-engine.js';
self.onmessage=({data})=>{
 try{self.postMessage({result:computeSurfaceDistance(new Float64Array(data.first),new Float64Array(data.second))});}
 catch(error){self.postMessage({error:error.message});}
};
