/* Copyright 2016 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
var vz_projector;
(function (vz_projector) {
    /**
     * This is a fork of the Karpathy's TSNE.js (original license below).
     * This fork implements Barnes-Hut approximation and runs in O(NlogN)
     * time, as opposed to the Karpathy's O(N^2) version.
     *
     * @author smilkov@google.com (Daniel Smilkov)
     */
    /**
     * Barnes-hut approximation level. Higher means more approximation and faster
     * results. Recommended value mentioned in the paper is 0.8.
     */
    var THETA = 0.8;
    var MIN_POSSIBLE_PROB = 1E-9;
    // Variables used for memorizing the second random number since running
    // gaussRandom() generates two random numbers at the cost of 1 atomic
    // computation. This optimization results in 2X speed-up of the generator.
    var return_v = false;
    var v_val = 0.0;
    /** Returns the square euclidean distance between two vectors. */
    function dist2(a, b) {
        if (a.length !== b.length) {
            throw new Error('Vectors a and b must be of same length');
        }
        var result = 0;
        for (var i = 0; i < a.length; ++i) {
            var diff = a[i] - b[i];
            result += diff * diff;
        }
        return result;
    }
    vz_projector.dist2 = dist2;
    /** Returns the square euclidean distance between two 2D points. */
    function dist2_2D(a, b) {
        var dX = a[0] - b[0];
        var dY = a[1] - b[1];
        return dX * dX + dY * dY;
    }
    vz_projector.dist2_2D = dist2_2D;
    /** Returns the square euclidean distance between two 3D points. */
    function dist2_3D(a, b) {
        var dX = a[0] - b[0];
        var dY = a[1] - b[1];
        var dZ = a[2] - b[2];
        return dX * dX + dY * dY + dZ * dZ;
    }
    vz_projector.dist2_3D = dist2_3D;
    function gaussRandom(rng) {
        if (return_v) {
            return_v = false;
            return v_val;
        }
        var u = 2 * rng() - 1;
        var v = 2 * rng() - 1;
        var r = u * u + v * v;
        if (r === 0 || r > 1) {
            return gaussRandom(rng);
        }
        var c = Math.sqrt(-2 * Math.log(r) / r);
        v_val = v * c; // cache this for next function call for efficiency
        return_v = true;
        return u * c;
    }
    ;
    // return random normal number
    function randn(rng, mu, std) {
        return mu + gaussRandom(rng) * std;
    }
    ;
    // utilitity that creates contiguous vector of zeros of size n
    function zeros(n) {
        return new Float64Array(n);
    }
    ;
    // utility that returns a matrix filled with random numbers
    // generated by the provided generator.
    function randnMatrix(n, d, rng) {
        var nd = n * d;
        var x = zeros(nd);
        for (var i = 0; i < nd; ++i) {
            x[i] = randn(rng, 0.0, 1E-4);
        }
        return x;
    }
    ;
    // utility that returns a matrix filled with the provided value.
    function arrayofs(n, d, val) {
        var x = [];
        for (var i = 0; i < n; ++i) {
            x.push(d === 3 ? [val, val, val] : [val, val]);
        }
        return x;
    }
    ;
    // compute (p_{i|j} + p_{j|i})/(2n)
    function nearest2P(nearest, perplexity, tol) {
        var N = nearest.length;
        var Htarget = Math.log(perplexity); // target entropy of distribution
        var P = zeros(N * N); // temporary probability matrix
        var K = nearest[0].length;
        var pRow = new Array(K); // pij[].
        for (var i = 0; i < N; ++i) {
            var neighbors = nearest[i];
            var betaMin = -Infinity;
            var betaMax = Infinity;
            var beta = 1; // initial value of precision
            var maxTries = 50;
            // perform binary search to find a suitable precision beta
            // so that the entropy of the distribution is appropriate
            var numTries = 0;
            while (true) {
                // compute entropy and kernel row with beta precision
                var psum = 0.0;
                for (var k = 0; k < neighbors.length; ++k) {
                    var neighbor = neighbors[k];
                    var pij = (i === neighbor.index) ? 0 : Math.exp(-neighbor.dist * beta);
                    pij = Math.max(pij, MIN_POSSIBLE_PROB);
                    pRow[k] = pij;
                    psum += pij;
                }
                // normalize p and compute entropy
                var Hhere = 0.0;
                for (var k = 0; k < pRow.length; ++k) {
                    pRow[k] /= psum;
                    var pij = pRow[k];
                    if (pij > 1E-7) {
                        Hhere -= pij * Math.log(pij);
                    }
                    ;
                }
                // adjust beta based on result
                if (Hhere > Htarget) {
                    // entropy was too high (distribution too diffuse)
                    // so we need to increase the precision for more peaky distribution
                    betaMin = beta; // move up the bounds
                    if (betaMax === Infinity) {
                        beta = beta * 2;
                    }
                    else {
                        beta = (beta + betaMax) / 2;
                    }
                }
                else {
                    // converse case. make distrubtion less peaky
                    betaMax = beta;
                    if (betaMin === -Infinity) {
                        beta = beta / 2;
                    }
                    else {
                        beta = (beta + betaMin) / 2;
                    }
                }
                numTries++;
                // stopping conditions: too many tries or got a good precision
                if (numTries >= maxTries || Math.abs(Hhere - Htarget) < tol) {
                    break;
                }
            }
            // copy over the final prow to P at row i
            for (var k = 0; k < pRow.length; ++k) {
                var pij = pRow[k];
                var j = neighbors[k].index;
                P[i * N + j] = pij;
            }
        } // end loop over examples i
        // symmetrize P and normalize it to sum to 1 over all ij
        var N2 = N * 2;
        for (var i = 0; i < N; ++i) {
            for (var j = i + 1; j < N; ++j) {
                var i_j = i * N + j;
                var j_i = j * N + i;
                var value = (P[i_j] + P[j_i]) / N2;
                P[i_j] = value;
                P[j_i] = value;
            }
        }
        return P;
    }
    ;
    // helper function
    function sign(x) {
        return x > 0 ? 1 : x < 0 ? -1 : 0;
    }
    function computeForce_2d(force, mult, pointA, pointB) {
        force[0] += mult * (pointA[0] - pointB[0]);
        force[1] += mult * (pointA[1] - pointB[1]);
    }
    function computeForce_3d(force, mult, pointA, pointB) {
        force[0] += mult * (pointA[0] - pointB[0]);
        force[1] += mult * (pointA[1] - pointB[1]);
        force[2] += mult * (pointA[2] - pointB[2]);
    }
    var TSNE = /** @class */ (function () {
        function TSNE(opt) {
            this.iter = 0;
            opt = opt || { dim: 2 };
            this.perplexity = opt.perplexity || 30;
            this.epsilon = opt.epsilon || 10;
            this.rng = opt.rng || Math.random;
            this.dim = opt.dim;
            if (opt.dim === 2) {
                this.dist2 = dist2_2D;
                this.computeForce = computeForce_2d;
            }
            else if (opt.dim === 3) {
                this.dist2 = dist2_3D;
                this.computeForce = computeForce_3d;
            }
            else {
                throw new Error('Only 2D and 3D is supported');
            }
        }
        // this function takes a fattened distance matrix and creates
        // matrix P from them.
        // D is assumed to be provided as an array of size N^2.
        TSNE.prototype.initDataDist = function (nearest) {
            var N = nearest.length;
            this.nearest = nearest;
            this.P = nearest2P(nearest, this.perplexity, 1E-4);
            this.N = N;
            this.initSolution(); // refresh this
        };
        // (re)initializes the solution to random
        TSNE.prototype.initSolution = function () {
            // generate random solution to t-SNE
            this.Y = randnMatrix(this.N, this.dim, this.rng); // the solution
            this.gains = arrayofs(this.N, this.dim, 1.0); // step gains
            // to accelerate progress in unchanging directions
            this.ystep = arrayofs(this.N, this.dim, 0.0); // momentum accumulator
            this.iter = 0;
        };
        // return pointer to current solution
        TSNE.prototype.getSolution = function () { return this.Y; };
        // perform a single step of optimization to improve the embedding
        TSNE.prototype.step = function (perturb) {
            this.iter += 1;
            var N = this.N;
            var grad = this.costGrad(this.Y); // evaluate gradient
            // perform gradient step
            var ymean = this.dim === 3 ? [0, 0, 0] : [0, 0];
            for (var i = 0; i < N; ++i) {
                for (var d = 0; d < this.dim; ++d) {
                    var gid = grad[i][d];
                    var sid = this.ystep[i][d];
                    var gainid = this.gains[i][d];
                    // compute gain update
                    var newgain = sign(gid) === sign(sid) ? gainid * 0.8 : gainid + 0.2;
                    if (newgain < 0.01) {
                        newgain = 0.01; // clamp
                    }
                    this.gains[i][d] = newgain; // store for next turn
                    // compute momentum step direction
                    var momval = this.iter < 250 ? 0.5 : 0.8;
                    var newsid = momval * sid - this.epsilon * newgain * grad[i][d];
                    this.ystep[i][d] = newsid; // remember the step we took
                    // step!
                    var i_d = i * this.dim + d;
                    this.Y[i_d] += newsid;
                    this.Y[i_d] *= 1.0 + perturb * (Math.random() - 1.0);
                    ymean[d] += this.Y[i_d]; // accumulate mean so that we
                    // can center later
                }
            }
            // reproject Y to be zero mean
            for (var i = 0; i < N; ++i) {
                for (var d = 0; d < this.dim; ++d) {
                    this.Y[i * this.dim + d] -= ymean[d] / N;
                }
            }
        };
        // return cost and gradient, given an arrangement
        TSNE.prototype.costGrad = function (Y) {
            var _this = this;
            var N = this.N;
            var P = this.P;
            // Trick that helps with local optima.
            var alpha = this.iter < 100 ? 4 : 1;
            // Make data for the SP tree.
            var points = new Array(N); // (x, y)[]
            for (var i = 0; i < N; ++i) {
                var iTimesD = i * this.dim;
                var row = new Array(this.dim);
                for (var d = 0; d < this.dim; ++d) {
                    row[d] = Y[iTimesD + d];
                }
                points[i] = row;
            }
            // Make a tree.
            var tree = new vz_projector.SPTree(points);
            var root = tree.root;
            // Annotate the tree.
            var annotateTree = function (node) {
                var numCells = 1;
                if (node.children == null) {
                    // Update the current node and tell the parent.
                    node.numCells = numCells;
                    node.yCell = node.point;
                    return { numCells: numCells, yCell: node.yCell };
                }
                // node.point is a 2 or 3-dim number[], so slice() makes a copy.
                var yCell = node.point.slice();
                for (var i = 0; i < node.children.length; ++i) {
                    var child = node.children[i];
                    if (child == null) {
                        continue;
                    }
                    var result = annotateTree(child);
                    numCells += result.numCells;
                    for (var d = 0; d < _this.dim; ++d) {
                        yCell[d] += result.yCell[d];
                    }
                }
                // Update the node and tell the parent.
                node.numCells = numCells;
                node.yCell = yCell.map(function (v) { return v / numCells; });
                return { numCells: numCells, yCell: yCell };
            };
            // Augment the tree with more info.
            annotateTree(root);
            tree.visit(function (node, low, high) {
                node.rCell = high[0] - low[0];
                return false;
            });
            // compute current Q distribution, unnormalized first
            var grad = [];
            var Z = 0;
            var forces = new Array(N);
            var _loop_1 = function (i) {
                var pointI = points[i];
                // Compute the positive forces for the i-th node.
                var Fpos = this_1.dim === 3 ? [0, 0, 0] : [0, 0];
                var neighbors = this_1.nearest[i];
                for (var k = 0; k < neighbors.length; ++k) {
                    var j = neighbors[k].index;
                    var pij = P[i * N + j];
                    var pointJ = points[j];
                    var squaredDistItoJ = this_1.dist2(pointI, pointJ);
                    var premult = pij / (1 + squaredDistItoJ);
                    this_1.computeForce(Fpos, premult, pointI, pointJ);
                }
                // Compute the negative forces for the i-th node.
                var FnegZ = this_1.dim === 3 ? [0, 0, 0] : [0, 0];
                tree.visit(function (node) {
                    var squaredDistToCell = _this.dist2(pointI, node.yCell);
                    // Squared distance from point i to cell.
                    if (node.children == null ||
                        (squaredDistToCell > 0 &&
                            node.rCell / Math.sqrt(squaredDistToCell) < THETA)) {
                        var qijZ_1 = 1 / (1 + squaredDistToCell);
                        var dZ = node.numCells * qijZ_1;
                        Z += dZ;
                        dZ *= qijZ_1;
                        _this.computeForce(FnegZ, dZ, pointI, node.yCell);
                        return true;
                    }
                    // Cell is too close to approximate.
                    var squaredDistToPoint = _this.dist2(pointI, node.point);
                    var qijZ = 1 / (1 + squaredDistToPoint);
                    Z += qijZ;
                    qijZ *= qijZ;
                    _this.computeForce(FnegZ, qijZ, pointI, node.point);
                    return false;
                }, true);
                forces[i] = [Fpos, FnegZ];
            };
            var this_1 = this;
            for (var i = 0; i < N; ++i) {
                _loop_1(i);
            }
            // Normalize the negative forces and compute the gradient.
            var A = 4 * alpha;
            var B = 4 / Z;
            for (var i = 0; i < N; ++i) {
                var _a = forces[i], FPos = _a[0], FNegZ = _a[1];
                var gsum = new Array(this.dim);
                for (var d = 0; d < this.dim; ++d) {
                    gsum[d] = A * FPos[d] - B * FNegZ[d];
                }
                grad.push(gsum);
            }
            return grad;
        };
        return TSNE;
    }());
    vz_projector.TSNE = TSNE;
})(vz_projector || (vz_projector = {})); // namespace vz_projector
