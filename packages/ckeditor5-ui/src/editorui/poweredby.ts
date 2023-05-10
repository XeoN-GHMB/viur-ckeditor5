/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module ui/editorui/poweredby
 */

import type { Editor } from '@ckeditor/ckeditor5-core';
import {
	Rect,
	DomEmitterMixin,
	findClosestScrollableAncestor,
	type PositionOptions,
	type Locale
} from '@ckeditor/ckeditor5-utils';
import BalloonPanelView from '../panel/balloon/balloonpanelview';
import IconView from '../icon/iconview';
import View from '../view';
import { throttle, type DebouncedFunc } from 'lodash-es';

import poweredByIcon from '../../theme/icons/project-logo.svg';
import type { UiConfig } from '@ckeditor/ckeditor5-core/src/editor/editorconfig';

const ICON_WIDTH = 53;
const ICON_HEIGHT = 10;
const NARROW_ROOT_WIDTH_THRESHOLD = 250;
const OFF_THE_SCREEN_POSITION = {
	top: -9999999,
	left: -9999999,
	name: 'invalid',
	config: {
		withArrow: false
	}
};

type PoweredByConfig = Required<UiConfig>[ 'poweredBy' ];

/**
 * A helper that enables the "powered by" feature in the editor and renders a link to the project's
 * webpage next to the bottom of the editing root when the editor is focused.
 *
 * @private
 */
export default class PoweredBy extends DomEmitterMixin() {
	/**
	 * Editor instance the helper was created for.
	 */
	private readonly editor: Editor;

	/**
	 * A reference to the balloon panel hosting and positioning the "powered by" link and logo.
	 */
	private _balloonView: BalloonPanelView | null;

	/**
	 * A throttled version of the {@link #_showBalloon} method meant for frequent use to avoid performance loss.
	 */
	private _showBalloonThrottled: DebouncedFunc<() => void>;

	/**
	 * A reference to the last editing root focused by the user. Since the focus can move to other focusable
	 * elements in the UI, this reference allows positioning the balloon over the right root whether the
	 * user is typing or using the UI.
	 */
	private _lastFocusedDOMRoot: HTMLElement | null;

	private _collisionInterval: ReturnType<typeof setInterval> | null;

	/**
	 * Creates a "powered by" helper for a given editor. The feature is initialized on Editor#ready
	 * event.
	 *
	 * @param editor
	 */
	constructor( editor: Editor ) {
		super();

		this.editor = editor;
		this._balloonView = null;
		this._lastFocusedDOMRoot = null;
		this._showBalloonThrottled = throttle( this._showBalloon.bind( this ), 50, { leading: true } );
		this._collisionInterval = null;

		editor.on( 'ready', this._handleEditorReady.bind( this ) );
	}

	/**
	 * Destroys the "powered by" helper along with its view.
	 */
	public destroy(): void {
		const balloon = this._balloonView;

		if ( balloon ) {
			// Balloon gets destroyed by the body collection.
			// The powered by view gets destroyed by the balloon.
			balloon.unpin();
			this._balloonView = null;
		}

		this._showBalloonThrottled.cancel();
		this.stopListening();
	}

	/**
	 * Enables "powered by" label once the editor (ui) is ready.
	 */
	private _handleEditorReady(): void {
		const editor = this.editor;

		// No view means no body collection to append the powered by balloon to.
		if ( !editor.ui.view ) {
			return;
		}

		editor.ui.focusTracker.on( 'change:isFocused', ( evt, data, isFocused ) => {
			if ( isFocused ) {
				const focusedElement = editor.ui.focusTracker.focusedElement! as HTMLElement;
				const domRoots = Array.from( editor.editing.view.domRoots.values() );

				if ( domRoots.includes( focusedElement ) ) {
					this._lastFocusedDOMRoot = focusedElement;
				} else {
					this._lastFocusedDOMRoot = domRoots[ 0 ];
				}

				this._showBalloon();
			} else {
				this._hideBalloon();

				this._lastFocusedDOMRoot = null;
			}
		} );

		editor.ui.on( 'update', () => {
			this._showBalloonThrottled();
		} );

		// TODO: Probably hide during scroll.
		// TODO: Problem with Rect#isVisible() and floating editors (comments) vs. hiding the view when cropped by parent with overflow.
		// TODO: Update position once an image loaded.
		// TODO: Make the position (side) configurable.
	}

	/**
	 * Creates an instance of the {@link module:ui/panel/balloon/balloonpanelview~BalloonPanelView balloon panel}
	 * with the "powered by" view inside ready for positioning.
	 */
	private _createBalloonView() {
		const editor = this.editor;
		const balloon = this._balloonView = new BalloonPanelView();
		const view = new PoweredByView( editor.locale );

		balloon.content.add( view );
		balloon.set( {
			class: 'ck-powered-by-balloon'
		} );

		editor.ui.view.body.add( balloon );
		editor.ui.focusTracker.add( balloon.element! );

		this._balloonView = balloon;
	}

	/**
	 * Attempts to display the balloon with the "powered by" view.
	 */
	private _showBalloon() {
		if ( !this._lastFocusedDOMRoot ) {
			return;
		}

		if ( !this._balloonView ) {
			this._createBalloonView();
		}

		const attachOptions = getBalloonAttachOptions( this.editor, this._lastFocusedDOMRoot, this._balloonView.element );

		if ( attachOptions ) {
			this._balloonView!.pin( attachOptions );

			this._startLookingForCollisions();
		}
	}

	/**
	 * Hides the "powered by" balloon if already visible.
	 */
	private _hideBalloon() {
		if ( this._balloonView ) {
			this._balloonView!.unpin();
			this._endLookingForCollisions();
		}
	}

	private _startLookingForCollisions() {
		this._repinOnCollision();
		this._collisionInterval = setInterval( this._repinOnCollision.bind( this ), 50 );
	}

	private _endLookingForCollisions() {
		clearInterval( this._collisionInterval! );
	}

	private _repinOnCollision() {
		if ( !this._lastFocusedDOMRoot ) {
			return;
		}

		const balloonViewElement = this._balloonView!.element!;
		const balloonRect = new Rect( balloonViewElement );
		const collidingElement = getCollidingElement( balloonRect, balloonViewElement, this._lastFocusedDOMRoot! );

		if ( collidingElement ) {
			console.log( 'interval: collision detected with', collidingElement );

			this._showBalloon();
		}
	}
}

/**
 * A view displaying a "powered by" label and project logo wrapped in a link.
 */
class PoweredByView extends View<HTMLDivElement> {
	/**
	 * Created an instance of the "powered by" view.
	 *
	 * @param locale The localization services instance.
	 */
	constructor( locale: Locale ) {
		super( locale );

		const iconView = new IconView();
		const bind = this.bindTemplate;

		iconView.set( {
			content: poweredByIcon,
			isColorInherited: false
		} );

		iconView.extendTemplate( {
			attributes: {
				style: {
					width: ICON_WIDTH + 'px',
					height: ICON_HEIGHT + 'px'
				}
			}
		} );

		this.setTemplate( {
			tag: 'div',
			attributes: {
				class: [ 'ck', 'ck-powered-by' ]
			},
			children: [
				{
					tag: 'a',
					attributes: {
						href: 'https://ckeditor.com',
						target: '_blank',
						tabindex: '-1'
					},
					children: [
						{
							tag: 'span',
							attributes: {
								class: [ 'ck', 'ck-powered-by__label' ]
							},
							children: [ 'Powered by' ]
						},
						iconView
					],
					on: {
						dragstart: bind.to( evt => evt.preventDefault() )
					}
				}
			]
		} );
	}
}

function getBalloonAttachOptions( editor: Editor, focusedDomRoot: HTMLElement, balloonViewElement: HTMLElement ):
	Partial<PositionOptions> | null
{
	const poweredByConfig = getNormalizedConfig( editor )!;
	const positioningFunction = poweredByConfig.side === 'right' ?
		getLowerRightCornerPosition( focusedDomRoot, balloonViewElement, poweredByConfig ) :
		getLowerLeftCornerPosition( focusedDomRoot, balloonViewElement, poweredByConfig );

	return {
		target: focusedDomRoot,
		positions: [ positioningFunction ]
	};
}

function getLowerRightCornerPosition( focusedDomRoot: HTMLElement, balloonViewElement: HTMLElement, config: PoweredByConfig ) {
	return getLowerCornerPosition( focusedDomRoot, balloonViewElement, config, ( rootRect, balloonRect ) => {
		return rootRect.left + rootRect.width - balloonRect.width - config.horizontalOffset;
	} );
}

function getLowerLeftCornerPosition( focusedDomRoot: HTMLElement, balloonViewElement: HTMLElement, config: PoweredByConfig ) {
	return getLowerCornerPosition( focusedDomRoot, balloonViewElement, config, rootRect => rootRect.left + config.horizontalOffset );
}

function getLowerCornerPosition(
	focusedDomRoot: HTMLElement,
	balloonViewElement: HTMLElement,
	config: PoweredByConfig,
	getBalloonLeft: ( rootRect: Rect, balloonRect: Rect ) => number
) {
	return ( rootRect: Rect, balloonRect: Rect ) => {
		const visibleRootRect = rootRect.getVisible();

		// Root cropped by ancestors.
		if ( !visibleRootRect ) {
			return OFF_THE_SCREEN_POSITION;
		}

		const isRootNarrow = rootRect.width < NARROW_ROOT_WIDTH_THRESHOLD;

		let balloonTop;

		if ( config.position === 'inside' ) {
			balloonTop = rootRect.bottom - balloonRect.height;
		}
		else {
			balloonTop = rootRect.bottom - balloonRect.height / 2;
		}

		balloonTop -= config.verticalOffset;

		let balloonLeft = getBalloonLeft( rootRect, balloonRect );
		const newBalloonRect = balloonRect.clone().moveTo( balloonLeft, balloonTop );
		const collidingElement = getCollidingElement( newBalloonRect, balloonViewElement, focusedDomRoot );

		if ( collidingElement ) {
			const collidingElementRect = new Rect( collidingElement );

			if ( config.side === 'right' ) {
				balloonLeft = collidingElementRect.left - balloonRect.width - 5;
			} else {
				balloonLeft = collidingElementRect.right + 5;
			}
		}

		if ( config.position === 'inside' ) {
			// The watermark cannot be positioned in this corner because the corner is not quite visible.
			if ( newBalloonRect.getIntersectionArea( visibleRootRect ) < newBalloonRect.getArea() ) {
				return OFF_THE_SCREEN_POSITION;
			}
		}
		else {
			const firstScrollableRootAncestor = findClosestScrollableAncestor( focusedDomRoot );

			if ( firstScrollableRootAncestor ) {
				const firstScrollableRootAncestorRect = new Rect( firstScrollableRootAncestor );

				// The watermark cannot be positioned in this corner because the corner is "not visible enough".
				if ( visibleRootRect.bottom + balloonRect.height / 2 > firstScrollableRootAncestorRect.bottom ) {
					return OFF_THE_SCREEN_POSITION;
				}
			}
		}

		return {
			top: balloonTop,
			left: balloonLeft,
			name: `root-width_${ isRootNarrow ? 'narrow' : 'default' }-position_${ config.position }-side_${ config.side }`,
			config: {
				withArrow: false
			}
		};
	};
}

function getNormalizedConfig( editor: Editor ): PoweredByConfig {
	const userConfig = editor.config.get( 'ui.poweredBy' );
	const position = userConfig && userConfig.position || 'inside';

	return {
		position,
		verticalOffset: position === 'inside' ? 5 : 0,
		horizontalOffset: 5,

		side: editor.locale.contentLanguageDirection === 'ltr' ? 'right' : 'left',
		...userConfig
	};
}

function getCollidingElement( balloonRect: Rect, balloonViewElement: HTMLElement, focusedDomRoot: HTMLElement ): HTMLElement | null {
	for ( let x = balloonRect.left; x <= balloonRect.right; x += 2 ) {
		for ( let y = balloonRect.top; y <= balloonRect.bottom; y += 2 ) {
			const elementsFromPoint = document.elementsFromPoint( x, y );

			for ( const element of elementsFromPoint ) {
				if ( balloonViewElement.contains( element ) ) {
					continue;
				}

				if ( element.contains( focusedDomRoot ) ) {
					break;
				}

				if ( !focusedDomRoot.contains( element ) ) {
					return element as HTMLElement;
				}
			}
		}
	}

	return null;
}