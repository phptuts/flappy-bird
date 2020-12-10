var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function onDestroy(fn) {
        get_current_component().$$.on_destroy.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function bind(component, name, callback) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            callback(component.$$.ctx[index]);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src/Bird.svelte generated by Svelte v3.30.1 */

    function create_fragment(ctx) {
    	let section;

    	return {
    		c() {
    			section = element("section");
    			set_style(section, "width", /*bird*/ ctx[0].size + "px");
    			set_style(section, "height", /*bird*/ ctx[0].size + "px");
    			set_style(section, "top", /*bird*/ ctx[0].top + "px");
    			set_style(section, "left", /*bird*/ ctx[0].left + "px");
    			attr(section, "id", "bird");
    			attr(section, "class", "svelte-1mfcebb");
    		},
    		m(target, anchor) {
    			insert(target, section, anchor);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*bird*/ 1) {
    				set_style(section, "width", /*bird*/ ctx[0].size + "px");
    			}

    			if (dirty & /*bird*/ 1) {
    				set_style(section, "height", /*bird*/ ctx[0].size + "px");
    			}

    			if (dirty & /*bird*/ 1) {
    				set_style(section, "top", /*bird*/ ctx[0].top + "px");
    			}

    			if (dirty & /*bird*/ 1) {
    				set_style(section, "left", /*bird*/ ctx[0].left + "px");
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(section);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	
    	let { bird } = $$props;

    	$$self.$$set = $$props => {
    		if ("bird" in $$props) $$invalidate(0, bird = $$props.bird);
    	};

    	return [bird];
    }

    class Bird extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, { bird: 0 });
    	}
    }

    class GameController {
        constructor(width = 400, height = 600, birdSize = 20, pipeWidth = 50, pipeGap = 150, minTopForTopPipe = 70, maxTopForTopPipe = 350, groundHeight = 20, speed = 1, birdX = 40, gravity = 1.5, jumpVelocity = 10, slowVelocityBy = 0.3, generateNewPipePercent = 0.7) {
            this.width = width;
            this.height = height;
            this.birdSize = birdSize;
            this.pipeWidth = pipeWidth;
            this.pipeGap = pipeGap;
            this.minTopForTopPipe = minTopForTopPipe;
            this.maxTopForTopPipe = maxTopForTopPipe;
            this.groundHeight = groundHeight;
            this.speed = speed;
            this.birdX = birdX;
            this.gravity = gravity;
            this.jumpVelocity = jumpVelocity;
            this.slowVelocityBy = slowVelocityBy;
            this.generateNewPipePercent = generateNewPipePercent;
            this.velocity = 0;
        }
        newGame() {
            let firstPipe = this.createPipe(true);
            let secondPipe = this.createPipe(false);
            this.frame = {
                score: 0,
                width: this.width,
                height: this.height,
                firstPipe,
                secondPipe,
                bird: {
                    left: this.birdX,
                    top: this.height / 2 - this.birdSize / 2,
                    size: this.birdSize,
                },
                ground: {
                    height: this.groundHeight,
                },
                gameOver: false,
                gameStarted: false,
            };
            return this.frame;
        }
        jump() {
            if (this.velocity <= 0) {
                this.velocity += this.jumpVelocity;
            }
        }
        start() {
            this.newGame();
            this.frame.gameStarted = true;
            return this.frame;
        }
        nextFrame() {
            if (this.frame.gameOver || !this.frame.gameStarted) {
                return this.frame;
            }
            this.frame.firstPipe = this.movePipe(this.frame.firstPipe, this.frame.secondPipe);
            this.frame.secondPipe = this.movePipe(this.frame.secondPipe, this.frame.firstPipe);
            if (this.velocity > 0) {
                this.velocity -= this.slowVelocityBy;
            }
            if (this.frame.bird.top >=
                this.height - this.groundHeight - this.birdSize) {
                this.frame.bird.top = this.height - this.groundHeight - this.birdSize;
                this.frame.gameOver = true;
                return this.frame;
            }
            if (this.hasCollidedWithPipe()) {
                this.frame.gameOver = true;
                return this.frame;
            }
            if (this.frame.firstPipe.left + this.pipeWidth == this.birdX - this.speed) {
                this.frame.score += 1;
            }
            if (this.frame.secondPipe.left + this.pipeWidth ==
                this.birdX - this.speed) {
                this.frame.score += 1;
            }
            this.frame.bird.top += Math.pow(this.gravity, 2) - this.velocity;
            return this.frame;
        }
        movePipe(pipe, otherPipe) {
            if (pipe.show && pipe.left <= this.pipeWidth * -1) {
                pipe.show = false;
                return pipe;
            }
            if (pipe.show) {
                pipe.left -= this.speed;
            }
            if (otherPipe.left < this.width * (1 - this.generateNewPipePercent) &&
                otherPipe.show &&
                !pipe.show) {
                return this.createPipe(true);
            }
            return pipe;
        }
        randomYForTopPipe() {
            return (this.minTopForTopPipe +
                (this.maxTopForTopPipe - this.minTopForTopPipe) * Math.random());
        }
        createPipe(show) {
            const height = this.randomYForTopPipe();
            return {
                topPipe: {
                    top: 0,
                    height,
                },
                bottomPipe: {
                    top: height + this.pipeGap,
                    height: this.height,
                },
                left: this.width + this.pipeWidth,
                width: this.pipeWidth,
                show,
            };
        }
        hasCollidedWithPipe() {
            if (this.frame.firstPipe.show &&
                this.checkPipe(this.frame.firstPipe.left)) {
                return !(this.frame.bird.top > this.frame.firstPipe.topPipe.height &&
                    this.frame.bird.top + this.birdSize <
                        this.frame.firstPipe.bottomPipe.top);
            }
            if (this.frame.secondPipe.show &&
                this.checkPipe(this.frame.secondPipe.left)) {
                return !(this.frame.bird.top > this.frame.secondPipe.topPipe.height &&
                    this.frame.bird.top + this.birdSize <
                        this.frame.secondPipe.bottomPipe.top);
            }
            return false;
        }
        checkPipe(left) {
            return (left <= this.birdX + this.birdSize && left + this.pipeWidth >= this.birdX);
        }
    }

    /* src/Pipe.svelte generated by Svelte v3.30.1 */

    function create_if_block(ctx) {
    	let section0;
    	let t;
    	let section1;

    	return {
    		c() {
    			section0 = element("section");
    			t = space();
    			section1 = element("section");
    			set_style(section0, "left", /*pipe*/ ctx[0].left + "px");
    			set_style(section0, "top", /*pipe*/ ctx[0].topPipe.top + "px");
    			set_style(section0, "width", /*pipe*/ ctx[0].width + "px");
    			set_style(section0, "height", /*pipe*/ ctx[0].topPipe.height + "px");
    			attr(section0, "class", "top-pipe pipe svelte-1i1t684");
    			set_style(section1, "left", /*pipe*/ ctx[0].left + "px");
    			set_style(section1, "top", /*pipe*/ ctx[0].bottomPipe.top + "px");
    			set_style(section1, "width", /*pipe*/ ctx[0].width + "px");
    			set_style(section1, "height", /*pipe*/ ctx[0].bottomPipe.height + "px");
    			attr(section1, "class", "top-bottom pipe svelte-1i1t684");
    		},
    		m(target, anchor) {
    			insert(target, section0, anchor);
    			insert(target, t, anchor);
    			insert(target, section1, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*pipe*/ 1) {
    				set_style(section0, "left", /*pipe*/ ctx[0].left + "px");
    			}

    			if (dirty & /*pipe*/ 1) {
    				set_style(section0, "top", /*pipe*/ ctx[0].topPipe.top + "px");
    			}

    			if (dirty & /*pipe*/ 1) {
    				set_style(section0, "width", /*pipe*/ ctx[0].width + "px");
    			}

    			if (dirty & /*pipe*/ 1) {
    				set_style(section0, "height", /*pipe*/ ctx[0].topPipe.height + "px");
    			}

    			if (dirty & /*pipe*/ 1) {
    				set_style(section1, "left", /*pipe*/ ctx[0].left + "px");
    			}

    			if (dirty & /*pipe*/ 1) {
    				set_style(section1, "top", /*pipe*/ ctx[0].bottomPipe.top + "px");
    			}

    			if (dirty & /*pipe*/ 1) {
    				set_style(section1, "width", /*pipe*/ ctx[0].width + "px");
    			}

    			if (dirty & /*pipe*/ 1) {
    				set_style(section1, "height", /*pipe*/ ctx[0].bottomPipe.height + "px");
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(section0);
    			if (detaching) detach(t);
    			if (detaching) detach(section1);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let if_block_anchor;
    	let if_block = /*pipe*/ ctx[0].show && create_if_block(ctx);

    	return {
    		c() {
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, [dirty]) {
    			if (/*pipe*/ ctx[0].show) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	
    	let { pipe } = $$props;

    	$$self.$$set = $$props => {
    		if ("pipe" in $$props) $$invalidate(0, pipe = $$props.pipe);
    	};

    	return [pipe];
    }

    class Pipe extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { pipe: 0 });
    	}
    }

    /* src/Game.svelte generated by Svelte v3.30.1 */

    function create_if_block_1(ctx) {
    	let section;
    	let t0;
    	let button;
    	let mounted;
    	let dispose;
    	let if_block = /*frame*/ ctx[1].gameOver && create_if_block_2(ctx);

    	return {
    		c() {
    			section = element("section");
    			if (if_block) if_block.c();
    			t0 = space();
    			button = element("button");
    			button.textContent = "Start Game";
    			attr(button, "class", "svelte-z0td85");
    			attr(section, "id", "init-screen");
    			attr(section, "class", "svelte-z0td85");
    		},
    		m(target, anchor) {
    			insert(target, section, anchor);
    			if (if_block) if_block.m(section, null);
    			append(section, t0);
    			append(section, button);

    			if (!mounted) {
    				dispose = listen(button, "click", /*startGame*/ ctx[2]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (/*frame*/ ctx[1].gameOver) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_2(ctx);
    					if_block.c();
    					if_block.m(section, t0);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(section);
    			if (if_block) if_block.d();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (95:12) {#if frame.gameOver}
    function create_if_block_2(ctx) {
    	let h20;
    	let t1;
    	let h21;
    	let t2;
    	let t3_value = /*frame*/ ctx[1].score + "";
    	let t3;

    	return {
    		c() {
    			h20 = element("h2");
    			h20.textContent = "Game Over";
    			t1 = space();
    			h21 = element("h2");
    			t2 = text("Score ");
    			t3 = text(t3_value);
    			attr(h20, "class", "svelte-z0td85");
    			attr(h21, "class", "svelte-z0td85");
    		},
    		m(target, anchor) {
    			insert(target, h20, anchor);
    			insert(target, t1, anchor);
    			insert(target, h21, anchor);
    			append(h21, t2);
    			append(h21, t3);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*frame*/ 2 && t3_value !== (t3_value = /*frame*/ ctx[1].score + "")) set_data(t3, t3_value);
    		},
    		d(detaching) {
    			if (detaching) detach(h20);
    			if (detaching) detach(t1);
    			if (detaching) detach(h21);
    		}
    	};
    }

    // (104:0) {#if debug}
    function create_if_block$1(ctx) {
    	let pre;
    	let t_value = JSON.stringify(/*frame*/ ctx[1], null, 2) + "";
    	let t;

    	return {
    		c() {
    			pre = element("pre");
    			t = text(t_value);
    			attr(pre, "class", "svelte-z0td85");
    		},
    		m(target, anchor) {
    			insert(target, pre, anchor);
    			append(pre, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*frame*/ 2 && t_value !== (t_value = JSON.stringify(/*frame*/ ctx[1], null, 2) + "")) set_data(t, t_value);
    		},
    		d(detaching) {
    			if (detaching) detach(pre);
    		}
    	};
    }

    function create_fragment$2(ctx) {
    	let main;
    	let section0;
    	let t0_value = /*frame*/ ctx[1].score + "";
    	let t0;
    	let t1;
    	let bird;
    	let updating_bird;
    	let t2;
    	let pipe0;
    	let updating_pipe;
    	let t3;
    	let pipe1;
    	let updating_pipe_1;
    	let t4;
    	let t5;
    	let section1;
    	let t6;
    	let if_block1_anchor;
    	let current;
    	let mounted;
    	let dispose;

    	function bird_bird_binding(value) {
    		/*bird_bird_binding*/ ctx[4].call(null, value);
    	}

    	let bird_props = {};

    	if (/*frame*/ ctx[1].bird !== void 0) {
    		bird_props.bird = /*frame*/ ctx[1].bird;
    	}

    	bird = new Bird({ props: bird_props });
    	binding_callbacks.push(() => bind(bird, "bird", bird_bird_binding));

    	function pipe0_pipe_binding(value) {
    		/*pipe0_pipe_binding*/ ctx[5].call(null, value);
    	}

    	let pipe0_props = {};

    	if (/*frame*/ ctx[1].firstPipe !== void 0) {
    		pipe0_props.pipe = /*frame*/ ctx[1].firstPipe;
    	}

    	pipe0 = new Pipe({ props: pipe0_props });
    	binding_callbacks.push(() => bind(pipe0, "pipe", pipe0_pipe_binding));

    	function pipe1_pipe_binding(value) {
    		/*pipe1_pipe_binding*/ ctx[6].call(null, value);
    	}

    	let pipe1_props = {};

    	if (/*frame*/ ctx[1].secondPipe !== void 0) {
    		pipe1_props.pipe = /*frame*/ ctx[1].secondPipe;
    	}

    	pipe1 = new Pipe({ props: pipe1_props });
    	binding_callbacks.push(() => bind(pipe1, "pipe", pipe1_pipe_binding));
    	let if_block0 = (/*frame*/ ctx[1].gameOver || !/*frame*/ ctx[1].gameStarted) && create_if_block_1(ctx);
    	let if_block1 = /*debug*/ ctx[0] && create_if_block$1(ctx);

    	return {
    		c() {
    			main = element("main");
    			section0 = element("section");
    			t0 = text(t0_value);
    			t1 = space();
    			create_component(bird.$$.fragment);
    			t2 = space();
    			create_component(pipe0.$$.fragment);
    			t3 = space();
    			create_component(pipe1.$$.fragment);
    			t4 = space();
    			if (if_block0) if_block0.c();
    			t5 = space();
    			section1 = element("section");
    			t6 = space();
    			if (if_block1) if_block1.c();
    			if_block1_anchor = empty();
    			attr(section0, "id", "score");
    			attr(section0, "class", "svelte-z0td85");
    			set_style(section1, "height", /*frame*/ ctx[1].ground.height + "px");
    			attr(section1, "id", "ground");
    			attr(section1, "class", "svelte-z0td85");
    			set_style(main, "width", /*frame*/ ctx[1].width + "px");
    			set_style(main, "height", /*frame*/ ctx[1].height + "px");
    			attr(main, "class", "game svelte-z0td85");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, section0);
    			append(section0, t0);
    			append(main, t1);
    			mount_component(bird, main, null);
    			append(main, t2);
    			mount_component(pipe0, main, null);
    			append(main, t3);
    			mount_component(pipe1, main, null);
    			append(main, t4);
    			if (if_block0) if_block0.m(main, null);
    			append(main, t5);
    			append(main, section1);
    			insert(target, t6, anchor);
    			if (if_block1) if_block1.m(target, anchor);
    			insert(target, if_block1_anchor, anchor);
    			current = true;

    			if (!mounted) {
    				dispose = listen(window, "click", /*jump*/ ctx[3]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if ((!current || dirty & /*frame*/ 2) && t0_value !== (t0_value = /*frame*/ ctx[1].score + "")) set_data(t0, t0_value);
    			const bird_changes = {};

    			if (!updating_bird && dirty & /*frame*/ 2) {
    				updating_bird = true;
    				bird_changes.bird = /*frame*/ ctx[1].bird;
    				add_flush_callback(() => updating_bird = false);
    			}

    			bird.$set(bird_changes);
    			const pipe0_changes = {};

    			if (!updating_pipe && dirty & /*frame*/ 2) {
    				updating_pipe = true;
    				pipe0_changes.pipe = /*frame*/ ctx[1].firstPipe;
    				add_flush_callback(() => updating_pipe = false);
    			}

    			pipe0.$set(pipe0_changes);
    			const pipe1_changes = {};

    			if (!updating_pipe_1 && dirty & /*frame*/ 2) {
    				updating_pipe_1 = true;
    				pipe1_changes.pipe = /*frame*/ ctx[1].secondPipe;
    				add_flush_callback(() => updating_pipe_1 = false);
    			}

    			pipe1.$set(pipe1_changes);

    			if (/*frame*/ ctx[1].gameOver || !/*frame*/ ctx[1].gameStarted) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_1(ctx);
    					if_block0.c();
    					if_block0.m(main, t5);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (!current || dirty & /*frame*/ 2) {
    				set_style(section1, "height", /*frame*/ ctx[1].ground.height + "px");
    			}

    			if (!current || dirty & /*frame*/ 2) {
    				set_style(main, "width", /*frame*/ ctx[1].width + "px");
    			}

    			if (!current || dirty & /*frame*/ 2) {
    				set_style(main, "height", /*frame*/ ctx[1].height + "px");
    			}

    			if (/*debug*/ ctx[0]) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block$1(ctx);
    					if_block1.c();
    					if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(bird.$$.fragment, local);
    			transition_in(pipe0.$$.fragment, local);
    			transition_in(pipe1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(bird.$$.fragment, local);
    			transition_out(pipe0.$$.fragment, local);
    			transition_out(pipe1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(bird);
    			destroy_component(pipe0);
    			destroy_component(pipe1);
    			if (if_block0) if_block0.d();
    			if (detaching) detach(t6);
    			if (if_block1) if_block1.d(detaching);
    			if (detaching) detach(if_block1_anchor);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let game = new GameController();
    	let frame = game.newGame();
    	let { debug = true } = $$props;

    	function startGame() {
    		$$invalidate(1, frame = game.start());
    	}

    	function jump() {
    		game.jump();
    	}

    	const interval = setInterval(
    		() => {
    			$$invalidate(1, frame = game.nextFrame());
    		},
    		1000 / 90
    	);

    	onDestroy(() => {
    		clearInterval(interval);
    	});

    	function bird_bird_binding(value) {
    		frame.bird = value;
    		$$invalidate(1, frame);
    	}

    	function pipe0_pipe_binding(value) {
    		frame.firstPipe = value;
    		$$invalidate(1, frame);
    	}

    	function pipe1_pipe_binding(value) {
    		frame.secondPipe = value;
    		$$invalidate(1, frame);
    	}

    	$$self.$$set = $$props => {
    		if ("debug" in $$props) $$invalidate(0, debug = $$props.debug);
    	};

    	return [
    		debug,
    		frame,
    		startGame,
    		jump,
    		bird_bird_binding,
    		pipe0_pipe_binding,
    		pipe1_pipe_binding
    	];
    }

    class Game extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, { debug: 0 });
    	}
    }

    /* src/App.svelte generated by Svelte v3.30.1 */

    function create_fragment$3(ctx) {
    	let game;
    	let current;
    	game = new Game({ props: { debug: true } });

    	return {
    		c() {
    			create_component(game.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(game, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(game.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(game.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(game, detaching);
    		}
    	};
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, null, create_fragment$3, safe_not_equal, {});
    	}
    }

    var app = new App({
        target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
